import { Post } from '@/app/page';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

const redis = Redis.fromEnv();

export async function POST(request: NextRequest) {
  try {
    const { callKey } = await request.json();

    if (!callKey) {
      return NextResponse.json(
        { error: 'No callKey provided' },
        { status: 400 }
      );
    }

    const posts = await redis.lrange<Post>(`${callKey}-posts`, 0, -1);

    if (!posts || posts.length === 0) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      posts
    });
  } catch (error) {
    console.error('Error checking workflow:', error);
    return NextResponse.json(
      { error: 'Failed to check workflow status' },
      { status: 500 }
    );
  }
}