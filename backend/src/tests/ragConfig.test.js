// backend/src/tests/ragConfig.test.js
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'ragConfig.js');

describe('ragConfig · umbral de similitud', () => {
  const ORIGINAL = process.env.RAG_SIMILARITY_THRESHOLD;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RAG_SIMILARITY_THRESHOLD;
    else process.env.RAG_SIMILARITY_THRESHOLD = ORIGINAL;
    jest.resetModules();
  });

  const load = () => {
    jest.resetModules();
    return require(CONFIG_PATH);
  };

  test('sin variable de entorno usa el valor calibrado (0.30)', () => {
    delete process.env.RAG_SIMILARITY_THRESHOLD;
    expect(load().RAG_SIMILARITY_THRESHOLD).toBe(0.3);
  });

  test('la variable de entorno sobreescribe el valor', () => {
    process.env.RAG_SIMILARITY_THRESHOLD = '0.42';
    expect(load().RAG_SIMILARITY_THRESHOLD).toBe(0.42);
  });

  test('un valor inválido cae al default en vez de romper el arranque', () => {
    process.env.RAG_SIMILARITY_THRESHOLD = 'no-es-un-numero';
    expect(load().RAG_SIMILARITY_THRESHOLD).toBe(0.3);
  });

  test('un valor fuera de rango cae al default', () => {
    process.env.RAG_SIMILARITY_THRESHOLD = '1.5';
    expect(load().RAG_SIMILARITY_THRESHOLD).toBe(0.3);
  });
});
