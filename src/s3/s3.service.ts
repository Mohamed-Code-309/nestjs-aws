import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { IAbstractStorage } from 'src/abstract.storage';
import { Readable } from 'stream';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3UploadResponse } from './dto/s3-upload-response';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Service implements IAbstractStorage {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly TEST_BUCKET: string;
  private readonly signedUrlExpiry = 60 * 60; // 1 hour

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.TEST_BUCKET = this.configService.get('TEST_BUCKET_NAME');
  }

  async onModuleInit() {
    this.logger.log('Initializing S3 Buckets');
    await this.checkAndCreateBucket(this.TEST_BUCKET);
  }

  async createBucket(bucketName: string): Promise<void> {
    await this.s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
    this.logger.log(`Bucket <<${bucketName}>> created`);
  }

  async checkBucket(bucketName: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      this.logger.log(`Bucket : ${bucketName} > exists: ${true}`);
      return true;
    } catch (error) {
      this.logger.log(`Bucket : ${bucketName} > exists: ${false}`);
      return false;
    }
  }

  async checkAndCreateBucket(bucketName: string) {
    try {
      const exists = await this.checkBucket(bucketName);
      if (!exists) {
        await this.createBucket(bucketName);
      }
    } catch (err) {
      this.logger.error(err);
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      if (!filePath) return false;
      //const [bucket, fileName] = filePath.split('/');
      const [bucket, ...rest] = filePath.split('/');
      const fileName = rest.join('/'); // Support nested paths
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: fileName }),
      );
      this.logger.log(`${filePath} Object deleted`);
      return true;
    } catch (error) {
      this.logger.error(error);
    }
  }

  async getObjectStream(filePath: string): Promise<Readable> {
    try {
      if (!filePath) return;
      const [bucket, fileName] = filePath?.split('/');
      const response = await this.s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: fileName }),
      );
      if (!response.Body) {
        throw new Error(`File ${fileName} not found in bucket ${bucket}`);
      }
      return response.Body as Readable;
    } catch (error) {
      this.logger.error(error);
    }
  }

  async downloadFromBucket(
    bucketName: string,
    fileName: string
  ) {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: fileName }),
      );
      if (!response.Body) {
        throw new Error(`File ${fileName} not found in bucket ${bucketName}`);
      }

      const downloadsDir = path.join(process.cwd(), 'downloads');

      // Ensure the downloads directory exists
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
      fileName = `${Date.now()}-${fileName}`;
      const filePath = path.join(downloadsDir, fileName);
      const fileStream = fs.createWriteStream(filePath);
      await new Promise<void>((resolve, reject) => {
        (response.Body as Readable)
          .pipe(fileStream)
          .on('finish', resolve)
          .on('error', reject);
      });
      this.logger.log(
        `Downloaded ${fileName} from ${bucketName} to ${filePath}`,
      );
    } catch (error) {
      throw new HttpException(
        error.message ??
        `Failed to download file from S3: ${bucketName}/${fileName}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  //Upload a file buffer to S3
  async putToBucket(
    file: { originalname: string; buffer: Buffer },
    bucket: string,
  ): Promise<string> {
    try {
      const timestamp = Date.now();
      const key = `${timestamp}-${file.originalname}`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
        }),
      );
      this.logger.log(`Uploaded file ${key} to bucket ${bucket}`);
      return `${bucket}/${key}`;
    } catch (error) {
      this.logger.error(error);
      throw new HttpException(
        'failed to save file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  //Upload a file from a local path to S3.
  async fPutToBucket(
    filePath: string,
    bucket: string
  ): Promise<string> {
    try {
      const fileStream = fs.createReadStream(filePath);
      const fileName = `${Date.now()}-${path.basename(filePath)}`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileName,
          Body: fileStream,
        }),
      );
      this.logger.log(
        `Uploaded file from ${filePath} as ${fileName} to bucket ${bucket}`,
      );
      return `${bucket}/${fileName}`;
    } catch (error) {
      this.logger.error(error);
      throw new HttpException(
        'failed to save file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  //-------------------------------------------------------------------------------------------------------------------
  //SIGNED-URL*********************************************************************************************************
  //-------------------------------------------------------------------------------------------------------------------
  //Unlike MINIO: Doesn't support fetch-progress that use chunks
  async generateSignedUrl(
    bucketName: string,
    chunkNumber?: number,
  ): Promise<{ signedUrl: string; fileName: string }> {
    try {
      const timestamp = Date.now().toString();
      const fileName =
        chunkNumber !== undefined
          ? `${timestamp}.chunk.${chunkNumber}.mp4`
          : `${timestamp}.mp4`;

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        //Metadata: TODO:Still
      });
      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: this.signedUrlExpiry,
      });
      this.logger.log(
        `Generated signed URL for ${fileName} in bucket ${bucketName}`,
      );
      return { signedUrl, fileName };
    } catch (error) {
      this.logger.error(`Error generating signed URL: ${error.message}`);
      throw error;
    }
  }

  async initiateVideoMultipartUpload(
    bucketName: string,
  ): Promise<{ uploadId: string; fileName: string }> {
    try {
      const fileName = `${Date.now().toString()}.mp4`;
      const command = new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: fileName,
      });
      const response = await this.s3Client.send(command);
      if (!response.UploadId) {
        throw new Error('Failed to initiate multipart upload');
      }
      this.logger.log(
        `Initiated multipart upload for ${fileName} with uploadId ${response.UploadId}`,
      );
      return { uploadId: response.UploadId, fileName };
    } catch (error) {
      this.logger.error(`Error initiating multipart upload: ${error.message}`);
      throw error;
    }
  }

  async getUploadedParts(
    bucketName: string,
    uploadId: string,
    fileName: string,
  ): Promise<any> {
    try {
      const command = new ListPartsCommand({
        Bucket: bucketName,
        Key: fileName,
        UploadId: uploadId,
      });
      const response = await this.s3Client.send(command);
      this.logger.log(
        `Retrieved uploaded parts for ${fileName} in bucket ${bucketName}`,
      );
      const parts = response.Parts.map((part) => new S3UploadResponse(part));
      return parts;
    } catch (error) {
      this.logger.error(`Error listing uploaded parts: ${error.message}`);
      throw error;
    }
  }

  async generateSignedUrlForChunk(
    bucketName: string,
    fileName: string,
    uploadId: string,
    partNumber: string,
  ): Promise<string> {
    try {
      const command = new UploadPartCommand({
        Bucket: bucketName,
        Key: fileName,
        PartNumber: parseInt(partNumber, 10),
        UploadId: uploadId,
      });
      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: this.signedUrlExpiry,
      });
      this.logger.log(
        `Generated signed URL for part ${partNumber} of ${fileName}`,
      );
      return signedUrl;
    } catch (error) {
      this.logger.error(
        `Error generating signed URL for chunk: ${error.message}`,
      );
      throw error;
    }
  }

  async completeMultipartUpload(
    bucketName: string,
    fileName: string,
    uploadId: string,
    parts: { part: number; etag: string }[],
  ): Promise<boolean> {
    try {
      // AWS expects parts in the format: { ETag: string, PartNumber: number }
      const formattedParts = parts.map((p) => ({
        ETag: p.etag,
        PartNumber: p.part,
      }));
      const command = new CompleteMultipartUploadCommand({
        Bucket: bucketName,
        Key: fileName,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: formattedParts,
        },
      });
      await this.s3Client.send(command);
      this.logger.log(
        `Completed multipart upload for ${fileName} with uploadId ${uploadId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Error completing multipart upload: ${error.message}`);
      throw error;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mergeVideoChunks(bucketName: string, files: Array<string>) {
    throw new Error('Method not implemented.');
  }
}
