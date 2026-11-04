// frontend/lib/screens/ideas/capture_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image_picker/image_picker.dart';
import 'processing_screen.dart';
import '../widgets/face_overlay_painter.dart';
import '../widgets/hand_overlay_painter.dart';
import '../widgets/quality_indicator.dart';

enum CaptureStep { face, faceConfirm, hands, handsConfirm, done }

class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key});

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  CameraController? _cameraController;
  List<CameraDescription>? _cameras;

  // Estado de detección
  CaptureStep _step = CaptureStep.face;
  Face? _detectedFace;

  // Imágenes capturadas
  Uint8List? _faceImage;
  /// Y-F4: geometría del último cuadro válido (ángulos y proporción del rostro).
  /// Viaja con la foto para que el backend la vuelva a validar: el cliente no es
  /// la única autoridad sobre si la captura sirve.
  Map<String, dynamic>? _captureGeometry;
  Uint8List? _handsImage;

  // Estado de validación
  String _instruction = 'Coloca tu rostro dentro del óvalo y presiona el botón para tomar la foto';
  bool _isFaceValid = false;
  bool _isHandValid = false;
  double _qualityScore = 0.0;
  String? _errorMessage;

  bool _isProcessing = false;
  bool _isCapturing = false;
  bool _isCameraReady = false;
  bool _isFlashOn = false;
  bool _isSwitchingCamera = false;
  int _validFramesCount = 0;

  late final FaceDetector _faceDetector;
  late final AnimationController _laserController;
  late final Animation<double> _laserAnimation;

  @override
  void initState() {
    super.initState();
    _faceDetector = FaceDetector(
      options: FaceDetectorOptions(
        enableContours: true,
        enableClassification: true,
        enableLandmarks: true,
        minFaceSize: 0.2,
      ),
    );

    _laserController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);

    _laserAnimation = Tween<double>(begin: 0.05, end: 0.95).animate(
      CurvedAnimation(parent: _laserController, curve: Curves.easeInOut),
    );

    _initializeCamera();
    // Y-F1f: si el permiso es de un texto anterior (o no hay permiso), no se abre la
    // cámara a medir. El backend también lo rechaza, pero negarse a capturar es más
    // honesto que pedir una foto para luego devolver un 403.
    _verificarConsentimiento();
  }

  Future<void> _verificarConsentimiento() async {
    final estado = await BiometricService.getConsentState();
    if (!mounted || !estado.known || estado.canScan) return;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(estado.needsReconsent ? 'Actualizamos el aviso' : 'Falta tu autorización'),
        content: Text(
          estado.needsReconsent
              ? 'Autorizaste el análisis con una versión anterior del aviso. La versión '
                  '${estado.currentVersion} explica qué huella de tu foto se conserva y para qué. '
                  'Acéptala para volver a medir.'
              : 'Para analizar tu piel necesitamos tu autorización sobre el tratamiento de datos '
                  'biométricos. Vuelve al inicio y acéptala para continuar.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );

    // Sin autorización vigente no se captura: se sale de la pantalla.
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _laserController.dispose();
    _disposeCamera();
    _faceDetector.close();
    super.dispose();
  }

  void _disposeCamera() {
    if (_cameraController != null) {
      try {
        if (_cameraController!.value.isStreamingImages) {
          _cameraController!.stopImageStream();
        }
      } catch (e) {
        debugPrint('Error al detener stream de cámara: $e');
      }
      try {
        _cameraController!.dispose();
      } catch (e) {
        debugPrint('Error al dispose controller: $e');
      }
      _cameraController = null;
    }
  }

  Future<void> _initializeCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras == null || _cameras!.isEmpty) {
        _showError('No se encontró ninguna cámara en el dispositivo.');
        return;
      }

      final frontCamera = _cameras!.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => _cameras!.first,
      );

      final controller = CameraController(
        frontCamera,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: Platform.isAndroid ? ImageFormatGroup.nv21 : ImageFormatGroup.bgra8888,
      );

      try {
        await controller.initialize();
      } on CameraException catch (e) {
        if (e.code == 'cameraPermission' || e.code == 'CameraAccessDenied') {
          _showError('Permiso de cámara denegado. Por favor, otorga el permiso en ajustes.');
          return;
        } else {
          rethrow;
        }
      }

      if (mounted) {
        _cameraController = controller;
        setState(() {
          _isCameraReady = true;
        });
        _startDetection();
      }
    } catch (e) {
      _showError('Error al iniciar la cámara: $e');
    }
  }

  // --- CAMBIO AUTOMÁTICO Y MANUAL BLINDADO DE CÁMARA ---
  Future<void> _switchCameraTo(CameraLensDirection targetDirection) async {
    if (_isSwitchingCamera) return;

    // Verificar si ya estamos en esa orientación y el controlador está activo
    if (_cameraController != null &&
        _cameraController!.value.isInitialized &&
        _cameraController!.description.lensDirection == targetDirection) {
      return;
    }

    setState(() {
      _isSwitchingCamera = true;
    });

    try {
      _cameras = await availableCameras();
      if (_cameras == null || _cameras!.isEmpty) return;

      // 1. Detener el stream de imágenes y dar tiempo al sistema operativo Android para liberar el hardware
      if (_cameraController != null) {
        if (_cameraController!.value.isStreamingImages) {
          try {
            await _cameraController!.stopImageStream();
          } catch (e) {
            debugPrint('Pausa de stream anterior: $e');
          }
        }
        await Future.delayed(const Duration(milliseconds: 250));
        try {
          await _cameraController!.dispose();
        } catch (e) {
          debugPrint('Dispose previo: $e');
        }
        _cameraController = null;
      }

      await Future.delayed(const Duration(milliseconds: 250));

      // 2. Buscar lentes compatibles con la dirección objetivo
      final matchingCameras = _cameras!.where((c) => c.lensDirection == targetDirection).toList();
      if (matchingCameras.isEmpty) {
        matchingCameras.add(_cameras!.first);
      }

      CameraController? newController;

      // Probar los lentes compatibles uno por uno (para soportar celulares con múltiples cámaras traseras)
      for (final cam in matchingCameras) {
        try {
          final candidate = CameraController(
            cam,
            ResolutionPreset.medium,
            enableAudio: false,
            imageFormatGroup: Platform.isAndroid ? ImageFormatGroup.nv21 : ImageFormatGroup.bgra8888,
          );
          await candidate.initialize();
          newController = candidate;
          break; // Conectado exitosamente
        } catch (err) {
          debugPrint('⚠️ Error probando cámara ${cam.name}: $err. Intentando alternativa...');
        }
      }

      // 3. RED DE SEGURIDAD ABSOLUTA: Si la cámara posterior no abrió, restaurar la cámara frontal automáticamente
      if (newController == null) {
        debugPrint('❌ Ninguna cámara posterior respondió. Restaurando cámara frontal de respaldo...');
        final fallbackCam = _cameras!.firstWhere(
          (c) => c.lensDirection == CameraLensDirection.front,
          orElse: () => _cameras!.first,
        );
        final fallbackController = CameraController(
          fallbackCam,
          ResolutionPreset.medium,
          enableAudio: false,
        );
        await fallbackController.initialize();
        newController = fallbackController;

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Uso de cámara posterior no disponible en este hardware. Usando cámara activa.'),
              duration: Duration(seconds: 3),
            ),
          );
        }
      }

      if (mounted) {
        _cameraController = newController;
        setState(() {
          _isCameraReady = true;
          _isFlashOn = false;
        });
        _startDetection();
      }
    } catch (e) {
      debugPrint('Error fatal en cambio de cámara: $e');
      if (mounted) {
        _showError('No se pudo inicializar la cámara seleccionada.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSwitchingCamera = false;
        });
      }
    }
  }

  Future<void> _switchCamera() async {
    final currentLens = _cameraController?.description.lensDirection ?? CameraLensDirection.front;
    final targetLens = (currentLens == CameraLensDirection.front)
        ? CameraLensDirection.back
        : CameraLensDirection.front;
    await _switchCameraTo(targetLens);
  }

  Future<void> _toggleFlash() async {
    if (_cameraController == null || !_cameraController!.value.isInitialized) return;
    try {
      _isFlashOn = !_isFlashOn;
      await _cameraController!.setFlashMode(
        _isFlashOn ? FlashMode.torch : FlashMode.off,
      );
      setState(() {});
    } catch (e) {
      debugPrint('Error al cambiar linterna/flash: $e');
    }
  }

  Future<void> _pickFromGallery() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
      if (picked != null) {
        final bytes = await picked.readAsBytes();
        if (_step == CaptureStep.face || _step == CaptureStep.faceConfirm) {
          setState(() {
            _faceImage = bytes;
            _step = CaptureStep.faceConfirm;
            _instruction = '✨ Foto de rostro cargada. Revisa o presiona Siguiente.';
          });
        } else {
          setState(() {
            _handsImage = bytes;
            _step = CaptureStep.handsConfirm;
            _instruction = '✨ Foto de mano cargada. Presiona Finalizar para procesar.';
          });
        }
      }
    } catch (e) {
      debugPrint('Error al seleccionar imagen de galería: $e');
      _showError('No se pudo cargar la imagen de la galería.');
    }
  }

  void _startDetection() {
    if (_cameraController == null || !_cameraController!.value.isInitialized) return;
    if (_step == CaptureStep.faceConfirm || _step == CaptureStep.handsConfirm) return;
    if (!_cameraController!.value.isStreamingImages) {
      try {
        _cameraController!.startImageStream(_processCameraImage);
      } catch (e) {
        debugPrint('Error al iniciar stream de imágenes: $e');
      }
    }
  }

  Future<void> _processCameraImage(CameraImage image) async {
    if (_isProcessing || _step == CaptureStep.done || !_isCameraReady || _isSwitchingCamera) return;
    if (_step == CaptureStep.faceConfirm || _step == CaptureStep.handsConfirm) return;
    _isProcessing = true;

    try {
      final inputImage = _convertCameraImageToInputImage(image);
      if (inputImage == null) return;

      if (_step == CaptureStep.face) {
        await _processFace(inputImage);
      } else if (_step == CaptureStep.hands) {
        await _processHands(image);
      }
    } catch (e, stack) {
      debugPrint('Error en procesamiento de imagen: $e\n$stack');
    } finally {
      _isProcessing = false;
    }
  }

  InputImage? _convertCameraImageToInputImage(CameraImage image) {
    try {
      final format = image.format.group;
      Uint8List bytes;
      int width = image.width;
      int height = image.height;
      int bytesPerRow = image.planes[0].bytesPerRow;

      if (format == ImageFormatGroup.nv21 || format == ImageFormatGroup.yuv420) {
        final yPlane = image.planes[0];
        final yBytes = yPlane.bytes;

        if (image.planes.length > 1) {
          final uvPlane = image.planes[1];
          final uvBytes = uvPlane.bytes;
          bytes = Uint8List(yBytes.length + uvBytes.length);
          bytes.setAll(0, yBytes);
          bytes.setAll(yBytes.length, uvBytes);
        } else {
          bytes = yBytes;
        }
      } else if (format == ImageFormatGroup.bgra8888) {
        final plane = image.planes[0];
        bytes = plane.bytes;
        bytesPerRow = plane.bytesPerRow;
      } else {
        final allBytes = WriteBuffer();
        for (final plane in image.planes) {
          allBytes.putUint8List(plane.bytes);
        }
        bytes = allBytes.done().buffer.asUint8List();
      }

      final sensorOrientation = _cameraController?.description.sensorOrientation ?? 270;
      InputImageRotation imageRotation = InputImageRotation.rotation270deg;
      if (sensorOrientation == 90) {
        imageRotation = InputImageRotation.rotation90deg;
      } else if (sensorOrientation == 180) {
        imageRotation = InputImageRotation.rotation180deg;
      } else if (sensorOrientation == 0) {
        imageRotation = InputImageRotation.rotation0deg;
      }

      InputImageFormat inputImageFormat;
      if (format == ImageFormatGroup.bgra8888 || Platform.isIOS) {
        inputImageFormat = InputImageFormat.bgra8888;
      } else {
        inputImageFormat = InputImageFormat.nv21;
      }

      final inputImageMetadata = InputImageMetadata(
        size: Size(width.toDouble(), height.toDouble()),
        rotation: imageRotation,
        format: inputImageFormat,
        bytesPerRow: bytesPerRow,
      );

      return InputImage.fromBytes(bytes: bytes, metadata: inputImageMetadata);
    } catch (e) {
      debugPrint('Error al convertir CameraImage a InputImage: $e');
      return null;
    }
  }

  // --- Procesamiento de rostro (Toma 100% MANUAL) ---
  Future<void> _processFace(InputImage inputImage) async {
    final faces = await _faceDetector.processImage(inputImage);
    if (faces.isEmpty) {
      if (mounted) {
        setState(() {
          _detectedFace = null;
          _isFaceValid = false;
          _instruction = 'No detectamos tu rostro. Enfuécalo y presiona el botón.';
          _qualityScore = 0.0;
        });
      }
      return;
    }

    final face = faces.first;
    final imageSize = inputImage.metadata?.size ?? const Size(480, 640);
    final isValid = _validateFace(face, imageSize);
    final quality = _calculateFaceQuality(face, imageSize);

    if (mounted) {
      setState(() {
        _detectedFace = face;
        _isFaceValid = isValid;
        _qualityScore = quality;
        // Y-F4: se guarda la geometría del cuadro que se va a capturar.
        if (isValid) {
          _captureGeometry = _buildGeometry(face, imageSize);
        }
        _instruction = isValid
            ? '✨ ¡Rostro Alineado 3D! Mantén la posición (Captura en 1.5s...)'
            : _getFaceInstruction(face, imageSize);
      });

      // AUTO-DISPARO AUTOMÁTICO INTELIGENTE (Sin tocar la pantalla)
      if (isValid && !_isCapturing) {
        _validFramesCount++;
        if (_validFramesCount >= 5) { // Estabilidad alcanzada durante ~1.5 segundos
          _validFramesCount = 0;
          _captureFace();
        }
      } else {
        _validFramesCount = 0;
      }
    }
  }

  /// Y-F4: geometría que el backend vuelve a validar. Mismas unidades que ML Kit
  /// (grados) y proporción del rostro sobre el ancho de la imagen, que es la
  /// aproximación de distancia cuando no hay profundidad.
  Map<String, dynamic> _buildGeometry(Face face, Size imageSize) {
    final box = face.boundingBox;
    final imageWidth = imageSize.width;
    final imageHeight = imageSize.height;

    return {
      'yaw': face.headEulerAngleY ?? 0.0,
      'roll': face.headEulerAngleZ ?? 0.0,
      'pitch': face.headEulerAngleX ?? 0.0,
      'faceRatio': imageWidth > 0 ? box.width / imageWidth : 0.0,
      'aspectRatio': box.width > 0 ? box.height / box.width : 0.0,
      'centerOffset': imageWidth > 0 && imageHeight > 0
          ? (box.center.dx - imageWidth / 2).abs() / (imageWidth / 2)
          : 0.0,
    };
  }

  bool _validateFace(Face face, Size imageSize) {
    final faceWidth = face.boundingBox.width;
    final imageWidth = imageSize.width;
    if (faceWidth < imageWidth * 0.22 || faceWidth > imageWidth * 0.85) return false;
    final aspectRatio = face.boundingBox.height / face.boundingBox.width;
    if (aspectRatio > 1.8 || aspectRatio < 0.7) return false;
    
    // Validar rotación de la cabeza para fotos frontales sin sesgo
    if (face.headEulerAngleY != null && face.headEulerAngleY!.abs() > 15) return false;
    if (face.headEulerAngleZ != null && face.headEulerAngleZ!.abs() > 15) return false;
    return true;
  }

  double _calculateFaceQuality(Face face, Size imageSize) {
    double score = 0.0;
    final imageWidth = imageSize.width;
    final sizeRatio = face.boundingBox.width / imageWidth;
    final sizeScore = (1 - (sizeRatio - 0.50).abs() / 0.35) * 40;
    score += sizeScore.clamp(0.0, 40.0);

    final faceCenterX = face.boundingBox.center.dx;
    final centerOffset = (faceCenterX - imageWidth / 2).abs();
    final centerScore = (1 - (centerOffset / (imageWidth / 2))) * 30;
    score += centerScore.clamp(0.0, 30.0);

    final aspectRatio = face.boundingBox.height / face.boundingBox.width;
    final ratioScore = (1 - (aspectRatio - 1.25).abs() / 0.55) * 30;
    score += ratioScore.clamp(0.0, 30.0);

    return score.clamp(0.0, 100.0);
  }

  String _getFaceInstruction(Face face, Size imageSize) {
    final imageWidth = imageSize.width;
    final faceWidth = face.boundingBox.width;

    if (face.headEulerAngleY != null && face.headEulerAngleY!.abs() > 15) {
      return '👤 Mira de frente a la cámara';
    }
    if (face.headEulerAngleZ != null && face.headEulerAngleZ!.abs() > 15) {
      return '👤 Mantén tu cabeza erguida';
    }

    if (faceWidth < imageWidth * 0.22) {
      return '📱 Acércate un poco más a la cámara';
    }
    if (faceWidth > imageWidth * 0.85) {
      return '📱 Aléjate un poco de la cámara';
    }

    final faceCenterX = face.boundingBox.center.dx;
    if (faceCenterX < imageWidth * 0.35) {
      return '👈 Mueve tu rostro hacia el centro';
    }
    if (faceCenterX > imageWidth * 0.65) {
      return '👉 Mueve tu rostro hacia el centro';
    }
    return '📸 Presiona el botón para capturar foto';
  }

  Future<void> _captureFace() async {
    if (_cameraController == null || !_cameraController!.value.isInitialized || _isCapturing) {
      _showError('La cámara no está lista');
      return;
    }
    _isCapturing = true;

    try {
      if (_cameraController!.value.isStreamingImages) {
        await _cameraController!.stopImageStream();
      }
      final image = await _cameraController!.takePicture();
      final file = File(image.path);
      _faceImage = await file.readAsBytes();

      if (mounted) {
        setState(() {
          _step = CaptureStep.faceConfirm;
          _instruction = '✨ Foto de rostro capturada. Presiona Siguiente para escanear manos.';
        });
      }
    } catch (e) {
      debugPrint('Error al capturar rostro: $e');
      _showError('Error al capturar rostro. Intenta de nuevo.');
      if (_cameraController != null && !_cameraController!.value.isStreamingImages) {
        _startDetection();
      }
    } finally {
      _isCapturing = false;
    }
  }

  // --- TRANSICIÓN AUTOMÁTICA AL PASO 2 (GIRA AUTOMÁTICAMENTE A CÁMARA POSTERIOR) ---
  void _proceedToHandsStep() async {
    setState(() {
      _step = CaptureStep.hands;
      _instruction = '🖐️ Girando a cámara posterior... Coloca el dorso de tu mano y presiona el botón';
      _isHandValid = false;
      _qualityScore = 0.0;
      _errorMessage = null;
    });

    // GIRO AUTOMÁTICO A CÁMARA POSTERIOR
    await _switchCameraTo(CameraLensDirection.back);
  }

  // --- REPETIR ROSTRO (GIRA AUTOMÁTICAMENTE A CÁMARA FRONTAL Y REINICIA STREAM) ---
  void _retakeFace() async {
    setState(() {
      _faceImage = null;
      _step = CaptureStep.face;
      _instruction = 'Coloca tu rostro dentro del óvalo y presiona el botón para tomar la foto';
      _isFaceValid = false;
      _qualityScore = 0.0;
      _validFramesCount = 0;
    });

    // GIRO AUTOMÁTICO A CÁMARA FRONTAL Y REINICIO DE STREAM
    await _switchCameraTo(CameraLensDirection.front);
    if (_cameraController != null && _cameraController!.value.isInitialized) {
      _startDetection();
    }
  }

  // --- Procesamiento de manos (Toma 100% MANUAL) ---
  Future<void> _processHands(CameraImage image) async {
    final yPlane = image.planes[0];
    final yBytes = yPlane.bytes;
    final width = image.width;
    final height = image.height;

    double sum = 0;
    int count = 0;
    for (int i = 0; i < 3; i++) {
      for (int j = 0; j < 3; j++) {
        final x = (width * (i + 1) ~/ 4);
        final y = (height * (j + 1) ~/ 4);
        final index = y * yPlane.bytesPerRow + x;
        if (index < yBytes.length) {
          sum += yBytes[index];
          count++;
        }
      }
    }
    final averageLuminosity = count > 0 ? sum / count : 0;
    final hasEnoughLight = averageLuminosity > 40;

    if (mounted) {
      setState(() {
        _isHandValid = hasEnoughLight;
        _qualityScore = hasEnoughLight ? 90.0 : 40.0;
        _instruction = _isHandValid
            ? '📸 Toca el botón central para tomar la foto de la mano'
            : '🖐️ Alinea tu mano con buena luz y presiona el botón';
      });
    }
  }

  Future<void> _captureHands() async {
    if (_cameraController == null || !_cameraController!.value.isInitialized || _isCapturing) {
      _showError('La cámara no está lista');
      return;
    }
    _isCapturing = true;

    try {
      if (_cameraController!.value.isStreamingImages) {
        await _cameraController!.stopImageStream();
      }
      final image = await _cameraController!.takePicture();
      final file = File(image.path);
      _handsImage = await file.readAsBytes();

      if (mounted) {
        setState(() {
          _step = CaptureStep.handsConfirm;
          _instruction = '✨ Foto de mano capturada. Presiona Finalizar para iniciar el análisis.';
        });
      }
    } catch (e) {
      debugPrint('Error al capturar manos: $e');
      _showError('Error al capturar manos. Intenta de nuevo.');
      if (_cameraController != null && !_cameraController!.value.isStreamingImages) {
        _startDetection();
      }
    } finally {
      _isCapturing = false;
    }
  }

  void _retakeHands() {
    setState(() {
      _handsImage = null;
      _step = CaptureStep.hands;
      _instruction = '🖐️ Coloca el dorso de tu mano sobre la silueta y presiona el botón';
      _isHandValid = false;
      _qualityScore = 0.0;
    });

    if (_cameraController != null && _cameraController!.value.isInitialized) {
      _startDetection();
    }
  }

  void _finishAndStartProcessing() {
    if (_faceImage == null || _handsImage == null) return;
    setState(() {
      _step = CaptureStep.done;
    });
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => ProcessingScreen(
          faceImage: _faceImage!,
          handsImage: _handsImage!,
          // Y-F4: la geometría medida en el cliente viaja con la foto.
          geometry: _captureGeometry,
        ),
      ),
    );
  }

  void _showError(String message) {
    if (mounted) {
      setState(() {
        _errorMessage = message;
        _instruction = message;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 4)),
      );
    }
  }

  // WIDGET: CÁMARA EN PANTALLA COMPLETA (FULL SCREEN EDGE-TO-EDGE)
  Widget _buildFullScreenCamera() {
    if (_cameraController == null || !_cameraController!.value.isInitialized) {
      return const SizedBox.expand();
    }
    final size = MediaQuery.of(context).size;
    final cameraSize = _cameraController!.value.previewSize!;

    var scale = size.aspectRatio * (cameraSize.width / cameraSize.height);
    if (scale < 1) scale = 1 / scale;

    return SizedBox.expand(
      child: ClipRect(
        child: Transform.scale(
          scale: scale,
          child: Center(
            child: CameraPreview(_cameraController!),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;
    final isFaceStep = _step == CaptureStep.face;
    final isFaceConfirm = _step == CaptureStep.faceConfirm;
    final isHandsStep = _step == CaptureStep.hands;
    final isHandsConfirm = _step == CaptureStep.handsConfirm;

    if (_cameraController == null || !_cameraController!.value.isInitialized || !_isCameraReady) {
          return Scaffold(
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: AppTheme.primary),
                  const SizedBox(height: 16),
                  Text(
                    _errorMessage ?? 'Inicializando cámara...',
                    style: TextStyle(color: AppTheme.text),
                    textAlign: TextAlign.center,
                  ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: () {
                  _faceImage = Uint8List(10);
                  _handsImage = Uint8List(10);
                  _finishAndStartProcessing();
                },
                icon: const Icon(Icons.auto_fix_high, color: Colors.black, size: 18),
                label: const Text(
                  '🎭 Continuar con Simulación Demo',
                  style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFC5A052),
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
              ),
            ],
          ),
        ),
        backgroundColor: AppTheme.background,
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: Container(
          margin: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppTheme.text.withValues(alpha: 0.5),
            shape: BoxShape.circle,
          ),
          child: IconButton(
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        title: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          decoration: BoxDecoration(
            color: AppTheme.text.withValues(alpha: 0.65),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            isFaceStep || isFaceConfirm
                ? 'Paso 1/2: Escanear rostro'
                : 'Paso 2/2: Escanear manos',
            style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
          ),
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 6),
            decoration: BoxDecoration(
              color: AppTheme.text.withValues(alpha: 0.5),
              shape: BoxShape.circle,
            ),
            child: IconButton(
              tooltip: 'Cambiar Linterna',
              icon: Icon(_isFlashOn ? Icons.flash_on : Icons.flash_off,
                  color: _isFlashOn ? Colors.amber : Colors.white),
              onPressed: _toggleFlash,
            ),
          ),
          Container(
            margin: const EdgeInsets.only(right: 6),
            decoration: BoxDecoration(
              color: AppTheme.text.withValues(alpha: 0.5),
              shape: BoxShape.circle,
            ),
            child: IconButton(
              tooltip: 'Cambiar Cámara Frontal/Posterior',
              icon: const Icon(Icons.cameraswitch_outlined, color: Colors.white),
              onPressed: _switchCamera,
            ),
          ),
          Container(
            margin: const EdgeInsets.only(right: 6),
            decoration: BoxDecoration(
              color: AppTheme.text.withValues(alpha: 0.5),
              shape: BoxShape.circle,
            ),
            child: IconButton(
              tooltip: 'Cargar de Galería',
              icon: const Icon(Icons.photo_library_outlined, color: Colors.white),
              onPressed: _pickFromGallery,
            ),
          ),
          Container(
            margin: const EdgeInsets.only(right: 12),
            child: TextButton.icon(
              onPressed: () {
                _faceImage = Uint8List(10);
                _handsImage = Uint8List(10);
                _finishAndStartProcessing();
              },
              icon: const Icon(Icons.auto_fix_high, size: 13, color: Color(0xFFF3D59B)),
              label: const Text('Demo', style: TextStyle(color: Color(0xFFF3D59B), fontWeight: FontWeight.bold, fontSize: 11)),
              style: TextButton.styleFrom(
                backgroundColor: Colors.black.withValues(alpha: 0.65),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              ),
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          // VISTA 1: Cámara en Vivo (PANTALLA COMPLETA 100% FULL SCREEN)
          if (isFaceStep || isHandsStep) Positioned.fill(child: _buildFullScreenCamera()),

          // VISTA 2: Confirmación de vista previa de foto capturada (Full Screen)
          if (isFaceConfirm && _faceImage != null)
            Positioned.fill(
              child: Image.memory(
                _faceImage!,
                fit: BoxFit.cover,
              ),
            ),

          if (isHandsConfirm && _handsImage != null)
            Positioned.fill(
              child: Image.memory(
                _handsImage!,
                fit: BoxFit.cover,
              ),
            ),

          // OVERLAY DE CARGA FLUIDO AL CAMBIAR LENTE
          if (_isSwitchingCamera)
                      Positioned.fill(
                        child: Container(
                          color: Colors.black87,
                          child: Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                CircularProgressIndicator(color: AppTheme.primary),
                                const SizedBox(height: 16),
                                const Text(
                                  'Girando lente de la cámara...',
                                  style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),

          // OVERLAY VIRTUAL LÁSER CON PALETA GLOWAPP (solo activo durante la cámara)
          if ((isFaceStep || isHandsStep) && !_isSwitchingCamera)
            Positioned.fill(
              child: AnimatedBuilder(
                animation: _laserAnimation,
                builder: (context, child) {
                  return AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: isFaceStep
                        ? RepaintBoundary(
                            key: const ValueKey('face_painter_boundary'),
                            child: SizedBox.expand(
                              child: CustomPaint(
                                key: const ValueKey('face_painter'),
                                painter: FaceOverlayPainter(
                                  detectedFace: _detectedFace,
                                  isValid: _isFaceValid,
                                  quality: _qualityScore,
                                  screenSize: screenSize,
                                ),
                              ),
                            ),
                          )
                        : RepaintBoundary(
                            key: const ValueKey('hands_painter_boundary'),
                            child: SizedBox.expand(
                              child: CustomPaint(
                                key: const ValueKey('hands_painter'),
                                painter: HandOverlayPainter(
                                  isValid: _isHandValid,
                                  quality: _qualityScore,
                                  screenSize: screenSize,
                                ),
                              ),
                            ),
                          ),
                  );
                },
              ),
            ),

          // CARD INFORMATIVA DE INSTRUCCIONES CON ESTILO GLOWAPP
          Positioned(
            bottom: 120,
            left: 24,
            right: 24,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 20),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1F1A15).withValues(alpha: 0.85),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: const Color(0xFFC5A052).withValues(alpha: 0.6),
                      width: 1.2,
                    ),
                  ),
                  child: Column(
                    children: [
                      if (isFaceStep || isHandsStep) QualityIndicator(quality: _qualityScore),
                      const SizedBox(height: 8),
                      Text(
                        _instruction,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      if (_errorMessage != null) ...[
                                              const SizedBox(height: 4),
                                              Text(
                                                _errorMessage!,
                                                style: TextStyle(color: AppTheme.errorBg, fontSize: 13),
                                                textAlign: TextAlign.center,
                                              ),
                                            ],
                    ],
                  ),
                ),
              ),
            ),
          ),

          // BOTONES INFERIORES DE ACCIÓN DE TOMA MANUAL CON PALETA HAUTE JOAILLERIE
          Positioned(
            bottom: 36,
            left: 24,
            right: 24,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // CASO 1: Toma de foto manual (Cámara activa para Rostro o Manos)
                    if (isFaceStep || isHandsStep)
                      Container(
                        width: 72,
                        height: 72,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(
                            colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Color(0x66C5A052),
                              blurRadius: 12,
                              offset: Offset(0, 4),
                            ),
                          ],
                        ),
                        child: IconButton(
                          onPressed: isFaceStep ? _captureFace : _captureHands,
                          icon: const Icon(
                            Icons.camera_alt_rounded,
                            size: 34,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                      ),

                    // CASO 2: Confirmación de Foto 1 (Rostro)
                    if (isFaceConfirm) ...[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _retakeFace,
                          icon: const Icon(Icons.refresh, color: Colors.white),
                          label: const Text('Repetir', style: TextStyle(color: Colors.white)),
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Colors.white54),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        flex: 2,
                        child: Container(
                          height: 50,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: ElevatedButton.icon(
                            onPressed: _proceedToHandsStep,
                            icon: const Icon(Icons.arrow_forward, color: Color(0xFF1F1A15)),
                            label: const Text(
                              'Siguiente: Manos ➔',
                              style: TextStyle(
                                fontFamily: 'Inter',
                                color: Color(0xFF1F1A15),
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.transparent,
                              shadowColor: Colors.transparent,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                            ),
                          ),
                        ),
                      ),
                    ],

                    // CASO 3: Confirmación de Foto 2 (Manos)
                    if (isHandsConfirm) ...[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _retakeHands,
                          icon: const Icon(Icons.refresh, color: Colors.white),
                          label: const Text('Repetir', style: TextStyle(color: Colors.white)),
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Colors.white54),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        flex: 2,
                        child: Container(
                          height: 50,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: ElevatedButton.icon(
                            onPressed: _finishAndStartProcessing,
                            icon: const Icon(Icons.auto_awesome, color: Color(0xFF1F1A15)),
                            label: const Text(
                              'Finalizar e Iniciar ➔',
                              style: TextStyle(
                                fontFamily: 'Inter',
                                color: Color(0xFF1F1A15),
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.transparent,
                              shadowColor: Colors.transparent,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
