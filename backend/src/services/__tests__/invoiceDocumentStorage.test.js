const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client { send(...args) { return mockSend(...args); } },
  GetObjectCommand: jest.fn(input => ({ input, command: 'get' })),
  PutObjectCommand: jest.fn(input => ({ input, command: 'put' }))
}));

const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const storage = require('../invoiceDocumentStorage');

describe('invoiceDocumentStorage', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.R2_ENDPOINT = 'https://r2.example.test';
    process.env.R2_ACCESS_KEY_ID = 'access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret-key';
    process.env.R2_BUCKET = 'private-bucket';
    process.env.R2_REGION = 'auto';
    delete process.env.NODE_ENV;
    delete process.env.RAILWAY_ENVIRONMENT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('stores invoice files encrypted under a tenant-scoped private key and retrieves the original bytes', async () => {
    const original = Buffer.from('%PDF-1.7 sample invoice');
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => PutObjectCommand.mock.calls[0][0].Body } });

    const stored = await storage.storeInvoiceDocument({
      tenantId: 'salon-17',
      invoiceNumber: 'INV-202611-0001',
      buffer: original,
      contentType: 'application/pdf',
      extension: 'pdf'
    });
    const uploaded = PutObjectCommand.mock.calls[0][0];
    expect(stored).toEqual(expect.objectContaining({ storage: 'r2', contentType: 'application/pdf' }));
    expect(uploaded.Key).toBe('private/saas-invoices/salon-17/INV-202611-0001.pdf.enc');
    expect(uploaded.Body).not.toEqual(original);
    expect(uploaded.ContentType).toBe('application/octet-stream');

    const loaded = await storage.loadInvoiceDocument({ tenantId: 'salon-17', invoiceNumber: 'INV-202611-0001' });
    expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: 'private-bucket', Key: uploaded.Key });
    expect(loaded).toEqual({ buffer: original, contentType: 'application/pdf', extension: 'pdf' });
  });

  it('rejects document keys that could escape the tenant-specific prefix', async () => {
    await expect(storage.storeInvoiceDocument({
      tenantId: '../other-tenant',
      invoiceNumber: 'INV-202611-0001',
      buffer: Buffer.from('x'),
      contentType: 'application/pdf',
      extension: 'pdf'
    })).rejects.toThrow('Identificador de tenant o número de comprobante inválido');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('fails closed in production if durable object storage is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.R2_ENDPOINT;
    await expect(storage.storeInvoiceDocument({
      tenantId: 'salon-17',
      invoiceNumber: 'INV-202611-0001',
      buffer: Buffer.from('x'),
      contentType: 'application/pdf',
      extension: 'pdf'
    })).rejects.toThrow('no se guardará el documento en disco efímero');
  });
});
