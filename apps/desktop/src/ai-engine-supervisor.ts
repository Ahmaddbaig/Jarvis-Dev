import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

export const AI_ENGINE_PROTOCOL = 'jarvis.ai-engine/1';
const SESSION_FILE = 'jarvis-ai-engine-session.json';
const RESTART_DELAYS_MS = [500, 2_000, 5_000] as const;

interface AIEngineHealth {
    ok: boolean;
    protocol: string;
    buildSha: string;
    engineVersion: string;
}

interface SupervisorOptions {
    isPackaged: boolean;
    appPath: string;
    resourcesPath: string;
    dataDir: string;
    localAIRoot: string;
    buildSha: string;
    localAIBaseUrl?: string;
}

export interface AIEngineSupervisorStatus {
    state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'unavailable';
    protocol: string;
    buildSha: string;
    processId?: number;
    port?: number;
    restarts: number;
    error?: string;
}

function redact(text: string): string {
    return text
        .replace(/(bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]')
        .replace(/("(?:token|authorization|api[_-]?key)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reserveLoopbackPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Could not reserve an AI engine port.')));
                return;
            }
            const port = address.port;
            server.close((error) => error ? reject(error) : resolve(port));
        });
    });
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
    const allowed = [
        'PATH', 'Path', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'TMPDIR',
        'LANG', 'LC_ALL', 'LC_CTYPE', 'PYTHONIOENCODING',
    ];
    const environment: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV,
        PYTHONUNBUFFERED: '1',
    };
    for (const name of allowed) {
        if (process.env[name]) environment[name] = process.env[name];
    }
    return environment;
}

export class AIEngineSupervisor {
    private child: ChildProcessWithoutNullStreams | null = null;
    private token: string | null = null;
    private port: number | null = null;
    private stopping = false;
    private restartTimer: NodeJS.Timeout | null = null;
    private restartCount = 0;
    private verifying = false;
    private currentStatus: AIEngineSupervisorStatus;

    constructor(private readonly options: SupervisorOptions) {
        this.currentStatus = {
            state: 'stopped',
            protocol: AI_ENGINE_PROTOCOL,
            buildSha: options.buildSha,
            restarts: 0,
        };
    }

    status(): AIEngineSupervisorStatus {
        return { ...this.currentStatus };
    }

    async start(): Promise<AIEngineSupervisorStatus> {
        this.stopping = false;
        this.restartCount = 0;
        this.removeSessionDescriptor();
        for (let attempt = 0; attempt <= RESTART_DELAYS_MS.length; attempt += 1) {
            if (attempt > 0) {
                this.restartCount = attempt;
                this.setStatus('restarting');
                await delay(RESTART_DELAYS_MS[attempt - 1]);
            }
            try {
                await this.launchAndVerify();
                return this.status();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[ai-engine] Startup attempt ${attempt + 1} failed: ${redact(message)}`);
                await this.stopChild();
                this.currentStatus.error = redact(message);
            }
        }
        this.setStatus('unavailable', this.currentStatus.error ?? 'AI engine failed to start.');
        return this.status();
    }

    private setStatus(state: AIEngineSupervisorStatus['state'], error?: string): void {
        this.currentStatus = {
            state,
            protocol: AI_ENGINE_PROTOCOL,
            buildSha: this.options.buildSha,
            processId: this.child?.pid,
            port: this.port ?? undefined,
            restarts: this.restartCount,
            ...(error ? { error: redact(error) } : {}),
        };
    }

    private command(): { executable: string; args: string[]; cwd: string } {
        if (this.options.isPackaged) {
            const executable = path.join(
                this.options.resourcesPath,
                'ai-engine',
                process.platform === 'win32' ? 'jarvis-ai-engine.exe' : 'jarvis-ai-engine',
            );
            if (!fs.existsSync(executable)) throw new Error(`The packaged AI engine is missing at ${executable}.`);
            return { executable, args: [], cwd: path.dirname(executable) };
        }
        const serviceRoot = path.join(this.options.appPath, 'services', 'ai-engine');
        const executable = process.platform === 'win32'
            ? path.join(serviceRoot, '.venv', 'Scripts', 'python.exe')
            : path.join(serviceRoot, '.venv', 'bin', 'python');
        if (!fs.existsSync(executable)) {
            throw new Error('The AI engine environment is missing. Run npm run ai:setup.');
        }
        return { executable, args: ['-m', 'jarvis_ai_engine.main'], cwd: serviceRoot };
    }

    private async launchAndVerify(): Promise<void> {
        this.verifying = true;
        try {
        this.setStatus('starting');
        this.port = await reserveLoopbackPort();
        this.token = crypto.randomBytes(32).toString('base64url');
        const command = this.command();
        const child = spawn(command.executable, command.args, {
            cwd: command.cwd,
            env: safeChildEnvironment(),
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.child = child;
        child.stdout.on('data', (chunk: Buffer) => console.log(`[ai-engine] ${redact(chunk.toString()).trimEnd()}`));
        child.stderr.on('data', (chunk: Buffer) => console.error(`[ai-engine] ${redact(chunk.toString()).trimEnd()}`));
        child.once('error', (error) => console.error('[ai-engine] Process error:', redact(error.message)));
        child.once('exit', (code, signal) => this.handleExit(child, code, signal));
        child.stdin.end(`${JSON.stringify({
            token: this.token,
            port: this.port,
            buildSha: this.options.buildSha,
            localAiRoot: this.options.localAIRoot,
            localAiBaseUrl: this.options.localAIBaseUrl ?? 'http://127.0.0.1:8080',
        })}\n`);

        const health = await this.waitForHealth(child);
        if (health.protocol !== AI_ENGINE_PROTOCOL) {
            throw new Error(`AI engine protocol ${health.protocol} does not match ${AI_ENGINE_PROTOCOL}.`);
        }
        if (health.buildSha !== this.options.buildSha) {
            throw new Error(`AI engine build ${health.buildSha} does not match ${this.options.buildSha}.`);
        }
        this.writeSessionDescriptor(child.pid!);
        this.setStatus('ready');
        console.log(`[ai-engine] Ready on loopback (protocol ${health.protocol}, engine ${health.engineVersion}).`);
        } finally {
            this.verifying = false;
        }
    }

    private async waitForHealth(child: ChildProcessWithoutNullStreams): Promise<AIEngineHealth> {
        let lastError = 'The health endpoint was not ready.';
        for (let attempt = 0; attempt < 80; attempt += 1) {
            if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(`AI engine exited before readiness (code ${String(child.exitCode)}, signal ${String(child.signalCode)}).`);
            }
            try {
                return await this.fetchHealth();
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                await delay(250);
            }
        }
        throw new Error(`AI engine health verification timed out: ${lastError}`);
    }

    private fetchHealth(): Promise<AIEngineHealth> {
        return new Promise((resolve, reject) => {
            if (!this.token || !this.port) return reject(new Error('AI engine credentials are unavailable.'));
            const request = http.request({
                host: '127.0.0.1',
                port: this.port,
                path: '/v1/health',
                method: 'GET',
                headers: { Authorization: `Bearer ${this.token}` },
                timeout: 1_000,
            }, (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => {
                    if (response.statusCode !== 200) return reject(new Error(`Health returned HTTP ${response.statusCode}.`));
                    try {
                        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AIEngineHealth;
                        if (payload.ok !== true) return reject(new Error('Health response was not ready.'));
                        resolve(payload);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            request.once('timeout', () => request.destroy(new Error('Health request timed out.')));
            request.once('error', reject);
            request.end();
        });
    }

    private descriptorPath(): string {
        return path.join(this.options.dataDir, SESSION_FILE);
    }

    private writeSessionDescriptor(pid: number): void {
        if (!this.token || !this.port) throw new Error('AI engine session is incomplete.');
        fs.mkdirSync(this.options.dataDir, { recursive: true });
        const target = this.descriptorPath();
        const temporary = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify({
            schemaVersion: 1,
            protocol: AI_ENGINE_PROTOCOL,
            host: '127.0.0.1',
            port: this.port,
            token: this.token,
            pid,
            buildSha: this.options.buildSha,
            startedAt: new Date().toISOString(),
        })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        try { fs.chmodSync(temporary, 0o600); } catch { /* Windows does not expose POSIX modes. */ }
        fs.renameSync(temporary, target);
        try { fs.chmodSync(target, 0o600); } catch { /* Windows does not expose POSIX modes. */ }
    }

    private removeSessionDescriptor(): void {
        try { fs.unlinkSync(this.descriptorPath()); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error('[ai-engine] Could not remove stale session descriptor:', redact(String(error)));
            }
        }
    }

    private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
        if (this.child !== child) return;
        this.removeSessionDescriptor();
        this.child = null;
        this.token = null;
        this.port = null;
        if (this.verifying)
            return;
        if (this.stopping) {
            this.setStatus('stopped');
            return;
        }
        const error = `AI engine exited unexpectedly (code ${String(code)}, signal ${String(signal)}).`;
        if (this.restartCount >= RESTART_DELAYS_MS.length) {
            this.setStatus('unavailable', error);
            return;
        }
        const delayMs = RESTART_DELAYS_MS[this.restartCount];
        this.restartCount += 1;
        this.setStatus('restarting', error);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.launchAndVerify().catch((restartError) => {
                const message = restartError instanceof Error ? restartError.message : String(restartError);
                console.error('[ai-engine] Restart failed:', redact(message));
                void this.stopChild().then(() => {
                    if (this.restartCount >= RESTART_DELAYS_MS.length) this.setStatus('unavailable', message);
                    else this.handleExitAfterFailedRestart(message);
                });
            });
        }, delayMs);
    }

    private handleExitAfterFailedRestart(message: string): void {
        if (this.stopping) return;
        if (this.restartCount >= RESTART_DELAYS_MS.length) {
            this.setStatus('unavailable', message);
            return;
        }
        const delayMs = RESTART_DELAYS_MS[this.restartCount];
        this.restartCount += 1;
        this.setStatus('restarting', message);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.launchAndVerify().catch((error) => {
                const nextMessage = error instanceof Error ? error.message : String(error);
                void this.stopChild().then(() => this.handleExitAfterFailedRestart(nextMessage));
            });
        }, delayMs);
    }

    private async stopChild(): Promise<void> {
        const child = this.child;
        this.child = null;
        this.removeSessionDescriptor();
        this.token = null;
        this.port = null;
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch { /* already gone */ }
                resolve();
            }, 8_000);
            child.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
            try { child.kill('SIGTERM'); } catch {
                clearTimeout(timeout);
                resolve();
            }
        });
    }

    async stop(): Promise<void> {
        this.stopping = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        await this.stopChild();
        this.setStatus('stopped');
    }
}
