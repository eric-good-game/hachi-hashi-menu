export interface PhotoStoragePort {
  save(itemId: string, data: Buffer, declaredContentType: string): Promise<string>;
  delete(filename: string): Promise<void>;
  read(filename: string): Promise<{ data: Buffer; contentType: string } | null>;
}
