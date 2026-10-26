// lib/design/components/s4_loading.dart
import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import '../../core/theme/tokens.dart';

/// S4 SkeletonLoader — shows a shimmer loading effect over its child.
/// Uses Token colors for base and highlight.
class S4SkeletonLoader extends StatelessWidget {
  final Widget child;
  final double borderRadius;

  const S4SkeletonLoader({
    super.key,
    required this.child,
    this.borderRadius = 0.0,
  });

  @override
  Widget build(BuildContext context) {
    // Use Token.light for simplicity; in production, make responsive to brightness.
    const Token token = Token.light;
    return Shimmer.fromColors(
      baseColor: token.surfaceLevel0,
      highlightColor: token.surfaceLevel2,
      child: Container(
        decoration: BoxDecoration(
          color: token.surfaceLevel0,
          borderRadius: BorderRadius.circular(borderRadius),
        ),
        child: child,
      ),
    );
  }
}

/// S4 SkeletonCard — a card-shaped skeleton loader.
/// Useful for placeholder cards in lists or grids.
class S4SkeletonCard extends StatelessWidget {
  final double width;
  final double height;
  final double borderRadius;

  const S4SkeletonCard({
    super.key,
    this.width = double.infinity,
    this.height = 100.0,
    this.borderRadius = 12.0,
  });

  @override
  Widget build(BuildContext context) {
    return S4SkeletonLoader(
      borderRadius: borderRadius,
      child: SizedBox(
        width: width,
        height: height,
      ),
    );
  }
}