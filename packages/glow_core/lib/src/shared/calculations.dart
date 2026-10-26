// frontend/lib/shared/calculations.dart

class Calculations {
  static double calculateTotalWithTip(double totalAmount, double tipAmount) {
    return totalAmount + tipAmount;
  }

  static double calculateTipAmount(double totalAmount, double percentage) {
    return totalAmount * (percentage / 100);
  }

  static double calculatePlatformFee(double totalAmount, double feePercentage) {
    return totalAmount * (feePercentage / 100);
  }

  static double calculateProviderEarnings(
      double totalAmount, double tipAmount, double feePercentage) {
    final fee = calculatePlatformFee(totalAmount, feePercentage);
    return totalAmount - fee + tipAmount;
  }
}
