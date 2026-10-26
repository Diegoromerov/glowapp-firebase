// lib/services/secure_storage_service.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  static final SecureStorageService _instance = SecureStorageService._internal();
  factory SecureStorageService() => _instance;
  SecureStorageService._internal();

  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    // 🛡️ FIX-FLUTTER-03: configuración web explícita. En Flutter Web el plugin
    // cifra el valor en vez de delegar en SharedPreferences (que mapea a
    // localStorage en texto plano). Se declaran las claves para que la
    // intención sea evidente y no dependa de los defaults implícitos.
    webOptions: WebOptions(
      dbName: 'FlutterEncryptedStorage',
      publicKey: 'FlutterSecureStorage',
    ),
  );

  Future<void> write(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  Future<String?> read(String key) async {
    return await _storage.read(key: key);
  }

  Future<void> delete(String key) async {
    await _storage.delete(key: key);
  }

  Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
