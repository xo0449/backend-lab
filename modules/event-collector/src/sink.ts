import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, CreateBucketCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import type { StoredEvent } from './event.js'

export const BUCKET = 'events'

/**
 * MinIO를 쓴다. S3와 API가 같아서 엔드포인트만 바꾸면 그대로 옮겨간다.
 */
export function createS3() {
  return new S3Client({
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    credentials: { accessKeyId: 'lab', secretAccessKey: 'labsecret' },
    forcePathStyle: true,
  })
}

export async function ensureBucket(s3: S3Client) {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  } catch (e: any) {
    const code = e?.name ?? e?.Code
    if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') throw e
  }
}

/**
 * 경로를 수신 시각으로 나눈다. 나중에 특정 기간만 읽을 수 있다.
 *   events/dt=2026-09-20/hour=14/<uuid>.jsonl
 *
 * JSON 배열이 아니라 한 줄에 하나씩 쓴다.
 * 파일이 중간에 끊겨도 앞부분은 읽을 수 있고, 이어붙이기도 쉽다.
 */
export function partitionKey(receivedAt: string): string {
  const [date, time] = receivedAt.split('T')
  const hour = time.slice(0, 2)
  return `events/dt=${date}/hour=${hour}/${randomUUID()}.jsonl`
}

export function createS3Sink(s3: S3Client) {
  return async function sink(batch: StoredEvent[]) {
    const key = partitionKey(batch[0].receivedAt)
    const body = batch.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }))
  }
}

export async function listKeys(s3: S3Client, prefix = 'events/'): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key)
    token = res.NextContinuationToken
  } while (token)
  return keys.sort()
}

export async function readEvents(s3: S3Client, key: string): Promise<StoredEvent[]> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const text = await res.Body!.transformToString()
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}
