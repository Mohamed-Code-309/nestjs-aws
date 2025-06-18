import internal from 'stream';

export interface IAbstractStorage {
  createBucket(bucketName: string): Promise<void>;
  checkBucket(bucketName: string): Promise<boolean>;
  checkAndCreateBucket(bucketName: string);
  deleteFile(filePath: string): Promise<boolean>;
  getObjectStream(filePath: string): Promise<internal.Readable>;
  downloadFromBucket(
    bucketName: string,
    fileName: string,
    localFilePath: string,
  );
  putToBucket(
    file: { originalname: string; buffer: Buffer },
    bucket: string,
  ): Promise<string>;
  fPutToBucket(
    filePath: string,
    bucket: string,
    fileName: string,
  ): Promise<string>;
  generateSignedUrl(
    bucketName: string,
    chunkNumber?: number,
  ): Promise<{ signedUrl: string; fileName: string }>;
  initiateVideoMultipartUpload(
    bucketName: string,
  ): Promise<{ uploadId: string; fileName: string }>;
  getUploadedParts(
    bucketName: string,
    uploadId: string,
    fileName: string,
  ): Promise<any>;
  generateSignedUrlForChunk(
    bucketName: string,
    fileName: string,
    uploadId: string,
    partNumber: string,
  ): Promise<string>;
  completeMultipartUpload(
    bucketName: string,
    fileName: string,
    uploadId: string,
    parts: { part: number; etag: string }[],
  ): Promise<boolean>;
  mergeVideoChunks(bucketName: string, files: Array<string>);
}
