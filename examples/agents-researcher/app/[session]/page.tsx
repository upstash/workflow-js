import { Suspense } from 'react';
import { AgentUI } from '../components/agent-ui';

export default async function Page({
    params,
  }: {
    params: Promise<{ session: string }>
  }) {
    const { session } = await params
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AgentUI session={session} />
    </Suspense>
  );
}