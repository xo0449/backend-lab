import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

export const BUCKET = 'lake'

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

export async function putText(s3: S3Client, key: string, body: string) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }))
}

export interface ObjectInfo {
  key: string
  size: number
}

export async function listObjects(s3: S3Client, prefix: string): Promise<ObjectInfo[]> {
  const out: ObjectInfo[] = []
  let token: string | undefined
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of res.Contents ?? []) {
      if (o.Key && typeof o.Size === 'number') out.push({ key: o.Key, size: o.Size })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return out
}

/**
 * 시나리오마다 앞의 결과가 남아 있으면 안 된다.
 * 파일 수가 달라지면 측정이 통째로 흔들린다.
 */
export async function clearPrefix(s3: S3Client, prefix: string) {
  const objects = await listObjects(s3, prefix)
  // 한 번에 지우는 API는 Content-MD5를 요구해서 이 조합에서는 400이 난다.
  // 지울 파일이 수백 개 수준이라 하나씩 보내도 눈에 띄게 느리지 않다.
  const CONCURRENCY = 16
  for (let i = 0; i < objects.length; i += CONCURRENCY) {
    await Promise.all(
      objects.slice(i, i + CONCURRENCY).map((o) =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: o.key })),
      ),
    )
  }
}
