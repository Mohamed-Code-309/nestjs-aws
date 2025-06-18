import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UploadedFile, UseInterceptors, HttpException, Res } from '@nestjs/common';
import { S3Service } from './s3.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

@Controller('s3')
export class S3Controller {
  constructor(private readonly s3Service: S3Service) { }

  // 1. Create a bucket
  @Post('bucket')
  async createBucket(@Query('name') name: string) {
    return this.s3Service.createBucket(name);
  }

  // 2. Check if a bucket exists
  @Get('bucket')
  async checkBucket(@Query('name') name: string) {
    return this.s3Service.checkBucket(name);
  }

  // 3. Delete a file from bucket
  @Delete('file')
  async deleteFile(@Query('path') path: string) {
    return this.s3Service.deleteFile(path);
  }

  // 4. Get a file stream (for download)
  @Get('stream')
  async getStream(@Query('path') path: string, @Res() res: Response) {
    const stream = await this.s3Service.getObjectStream(path);
    if (!stream) throw new HttpException('Stream not found', 404);
    // return stream; //WRONG
    stream.pipe(res);
  }

  // 5. Download file to local system (server-side only)
  @Post('download')
  async downloadFile(
    @Query('bucket') bucket: string,
    @Query('fileName') fileName: string
  ) {
    return this.s3Service.downloadFromBucket(bucket, fileName);
  }

  // 6. Upload file via buffer (from form (form-data))
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: any, //Express.Multer.File,
    @Query('bucket') bucket: string,
  ) {
    return this.s3Service.putToBucket(file, bucket);
  }

  // 7. Upload from file path on disk
  @Post('fupload')
  async uploadFromPath(
    @Body() body: { filePath: string; bucket: string },
  ) {
    return this.s3Service.fPutToBucket(body.filePath, body.bucket);
  }

  // 8. Generate signed URL for upload
  @Get('signed-url')
  async signedUrl(
    @Query('bucket') bucket: string,
    @Query('chunk') chunk?: string
  ) {
    return this.s3Service.generateSignedUrl(
      bucket,
      chunk ? Number(chunk) : undefined,
    );
  }

  // 9. Initiate multipart upload
  @Get('multipart/initiate')
  async initiateMultipart(@Query('bucket') bucket: string) {
    return this.s3Service.initiateVideoMultipartUpload(bucket);
  }

  // 10. Get uploaded parts (for multipart)
  @Get('multipart/parts')
  async listParts(
    @Query('bucket') bucket: string,
    @Query('key') key: string,
    @Query('uploadId') uploadId: string,
  ) {
    return this.s3Service.getUploadedParts(bucket, uploadId, key);
  }

  // 11. Generate signed URL for chunk upload
  @Get('multipart/signed-url')
  async signedUrlForChunk(
    @Query('bucket') bucket: string,
    @Query('fileName') fileName: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber') partNumber: string,
  ) {
    return this.s3Service.generateSignedUrlForChunk(
      bucket,
      fileName,
      uploadId,
      partNumber,
    );
  }

  // 12. Complete multipart upload
  @Post('multipart/complete')
  async completeMultipart(
    @Body()
    body: {
      bucket: string;
      fileName: string;
      uploadId: string;
      parts: { part: number; etag: string }[];
    },
  ) {
    return this.s3Service.completeMultipartUpload(
      body.bucket,
      body.fileName,
      body.uploadId,
      body.parts,
    );
  }

  // 13. Merge video chunks (not implemented)
  @Post('merge')
  async mergeChunks(
    @Body() body: { bucket: string; files: string[] },
  ) {
    return this.s3Service.mergeVideoChunks(body.bucket, body.files);
  }
}
