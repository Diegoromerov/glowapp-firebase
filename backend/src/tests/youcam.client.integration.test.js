// backend/src/tests/youcam.client.integration.test.js
/**
 * Integration tests for YouCam client focusing on resilience behavior.
 * We mock axios to simulate external failures and verify retry behavior.
 */

const youcamClient = require('../services/biometric/youcam.client');
const { breakers } = require('../services/circuitBreakerService');

jest.mock('axios');

describe('YouCamClient Resilience Integration', () => {
  let axiosMock;

  beforeEach(() => {
    axiosMock = require('axios');
    // Set a dummy API key to avoid early throws
    youcamClient.apiKey = 'test-key';
    // Reset the YouCam circuit breaker to avoid cross-test pollution
    breakers.youcam.reset();
    breakers.youcam.failureThreshold = 10; // Allow 4 retries without tripping circuit in this mock test
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('_requestUploadSlot reintenta y falla en cerrado (sin datos simulados)', async () => {
    axiosMock.post.mockRejectedValue(new Error('Network Error'));

    const buffer = Buffer.from('test image');

    // El fallback que devolvia { fileId: 'test-file-id', ... } se elimino a proposito en
    // 94b199b45 ("remove simulated results"): inventar un fileId inexistente escondia la
    // caida de YouCam y dejaba continuar el flujo con datos falsos.
    await expect(youcamClient._requestUploadSlot(buffer)).rejects.toThrow();

    // 1 intento + 3 reintentos = 4 llamadas: la resiliencia sigue vigente
    expect(axiosMock.post).toHaveBeenCalledTimes(4);
  });

  test('_uploadToS3 reintenta y falla en cerrado (sin datos simulados)', async () => {
    axiosMock.put.mockRejectedValue(new Error('Network Error'));

    const uploadUrl = 'https://s3.example.com/upload';
    const uploadHeaders = {};
    const buffer = Buffer.from('test image');

    // Devolver `undefined` simulaba una subida correcta: el pipeline continuaba con un
    // file_id que nunca llego a subirse.
    await expect(youcamClient._uploadToS3(uploadUrl, uploadHeaders, buffer)).rejects.toThrow();

    expect(axiosMock.put).toHaveBeenCalledTimes(4);
  });

  test('_createAnalysisTask reintenta y falla en cerrado (sin datos simulados)', async () => {
    axiosMock.post.mockRejectedValue(new Error('Network Error'));

    const fileId = 'test-file-id';

    // Devolver 'test-task-id' inventaba una tarea de analisis que nunca existio en YouCam.
    await expect(youcamClient._createAnalysisTask(fileId)).rejects.toThrow();

    expect(axiosMock.post).toHaveBeenCalledTimes(4);
  });

  test('_pollTaskResult reintenta y falla en cerrado (sin puntuaciones simuladas)', async () => {
    axiosMock.get.mockRejectedValue(new Error('Network Error'));

    const taskId = 'test-task-id';

    // El fallback devolvia una piel inventada (hidratacion 75, arrugas 15, manchas 12,
    // poros 25, edad 28). Presentar eso como analisis real del usuario es el peor
    // resultado posible: debe fallar, no inventar.
    await expect(youcamClient._pollTaskResult(taskId)).rejects.toThrow();

    expect(axiosMock.get).toHaveBeenCalledTimes(4);
  }, 10000);
});