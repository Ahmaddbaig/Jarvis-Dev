'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createJarvisQueryClient } from '@/frontend/lib/query/client';

export function JarvisQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createJarvisQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
