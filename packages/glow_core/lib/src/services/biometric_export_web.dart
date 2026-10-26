import 'dart:html' as html;

void downloadBiometricExport(String payload) {
  final blob = html.Blob([payload], 'application/json');
  final url = html.Url.createObjectUrlFromBlob(blob);
  html.AnchorElement(href: url)
    ..setAttribute('download', 'glowapp-biometric-data.json')
    ..click();
  html.Url.revokeObjectUrl(url);
}
