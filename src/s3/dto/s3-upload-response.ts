import { Part } from '@aws-sdk/client-s3';

export class S3UploadResponse {
  part: number;
  lastModified: Date;
  etag: string;
  size: number;

  constructor(s3Part: Part) {
    this.part = s3Part.PartNumber;
    this.lastModified = s3Part.LastModified;
    this.etag = s3Part.ETag;
    this.size = s3Part.Size;
  }
}
