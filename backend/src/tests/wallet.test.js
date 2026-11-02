// backend/src/tests/wallet.test.js
// Suite de pruebas para Wallet y Cuenta Bancaria del Prestador

describe('Wallet & Bank Account Contract Suite', () => {

  describe('1. Validaciones de Cuenta Bancaria', () => {
    const validarCuentaBancaria = ({ tipo_cuenta, banco, numero_cuenta }) => {
      if (!numero_cuenta || typeof numero_cuenta !== 'string' || numero_cuenta.trim().length < 6) {
        return { valid: false, error: 'Número de cuenta inválido (mínimo 6 caracteres).' };
      }
      const tipoNormalizado = (tipo_cuenta || 'NEQUI').toUpperCase();
      const bancoNormalizado = (tipoNormalizado === 'NEQUI')
        ? 'Nequi'
        : (tipoNormalizado === 'DAVIPLATA')
          ? 'Daviplata'
          : (banco || 'Bancolombia');
      const tipoCuentaFinal = (tipoNormalizado === 'NEQUI' || tipoNormalizado === 'DAVIPLATA')
        ? tipoNormalizado
        : 'BANCARIA';
      const tipoBancariaFinal = (tipoNormalizado === 'CORRIENTE') ? 'CORRIENTE' : 'AHORROS';
      return {
        valid: true,
        tipo_cuenta: tipoCuentaFinal,
        banco: bancoNormalizado,
        numero_cuenta: numero_cuenta.trim(),
        tipo_cuenta_bancaria: tipoBancariaFinal,
        cuenta_verificada: true
      };
    };
    test('Rechaza numero de cuenta vacio o menor a 6 digitos', () => {
      expect(validarCuentaBancaria({ numero_cuenta: '' }).valid).toBe(false);
      expect(validarCuentaBancaria({ numero_cuenta: '12345' }).valid).toBe(false);
    });
    test('Normaliza cuenta Nequi automaticamente', () => {
      const res = validarCuentaBancaria({ tipo_cuenta: 'NEQUI', numero_cuenta: '3001234567' });
      expect(res.valid).toBe(true);
      expect(res.tipo_cuenta).toBe('NEQUI');
      expect(res.banco).toBe('Nequi');
      expect(res.tipo_cuenta_bancaria).toBe('AHORROS');
      expect(res.cuenta_verificada).toBe(true);
    });
    test('Normaliza cuentas bancarias tradicionales', () => {
      const ahorros = validarCuentaBancaria({ tipo_cuenta: 'AHORROS', banco: 'Bancolombia', numero_cuenta: '9876543210' });
      expect(ahorros.valid).toBe(true);
      expect(ahorros.tipo_cuenta).toBe('BANCARIA');
      expect(ahorros.banco).toBe('Bancolombia');
      expect(ahorros.tipo_cuenta_bancaria).toBe('AHORROS');
    });
  });

  describe('2. Enmascaramiento Seguro de Cuentas', () => {
    const enmascararCuenta = (numero) => {
      if (!numero) return '****';
      const s = String(numero).trim();
      return s.length > 4 ? `****${s.slice(-4)}` : '****';
    };
    test('Enmascara numeros largos mostrando solo los ultimos 4 digitos', () => {
      expect(enmascararCuenta('3001234567')).toBe('****4567');
    });
    test('Maneja numeros cortos o nulos sin filtrar datos privados', () => {
      expect(enmascararCuenta('1234')).toBe('****');
      expect(enmascararCuenta(null)).toBe('****');
    });
  });

  describe('3. Reglas de Validacion de Retiro', () => {
    const validarRetiro = (wallet, montoSolicitado, minCop = 50000, diasMin = 3) => {
      if (!wallet) return { ok: false, error: 'Wallet no encontrado', code: 404 };
      if (!montoSolicitado || isNaN(montoSolicitado) || montoSolicitado <= 0) {
        return { ok: false, error: 'Monto invalido', code: 400 };
      }
      if (wallet.retiros_pausados) {
        return { ok: false, error: 'Retiros pausados', code: 403 };
      }
      if (!wallet.cuenta_verificada) {
        return { ok: false, error: 'Debes verificar tu cuenta bancaria antes de retirar', code: 403 };
      }
      if (montoSolicitado < minCop) {
        return { ok: false, error: `El monto mínimo de retiro es $${minCop} COP`, code: 400 };
      }
      if (montoSolicitado > parseFloat(wallet.saldo_disponible)) {
        return { ok: false, error: 'Saldo disponible insuficiente', code: 400 };
      }
      return { ok: true };
    };

    const baseWallet = {
      id: 'w-1',
      provider_id: 10,
      saldo_disponible: 150000,
      cuenta_verificada: true,
      retiros_pausados: false,
      ultimo_retiro_at: null,
      banco: 'Nequi',
      numero_cuenta: '3001234567'
    };

    test('Rechaza retiro si la cuenta bancaria no esta verificada', () => {
      const res = validarRetiro({ ...baseWallet, cuenta_verificada: false }, 70000);
      expect(res.ok).toBe(false);
      expect(res.code).toBe(403);
    });

    test('Rechaza retiro si el monto es menor al minimo permitido', () => {
      const res = validarRetiro(baseWallet, 30000);
      expect(res.ok).toBe(false);
      expect(res.code).toBe(400);
    });

    test('Rechaza retiro si supera el saldo disponible', () => {
      const res = validarRetiro(baseWallet, 200000);
      expect(res.ok).toBe(false);
      expect(res.code).toBe(400);
    });

    test('Aprueba retiro valido con cuenta verificada y saldo suficiente', () => {
      const res = validarRetiro(baseWallet, 70000);
      expect(res.ok).toBe(true);
    });
  });

});
