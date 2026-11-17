/// Controls whether map widgets request remote raster tiles.
///
/// Widget tests disable network tiles to keep rendering independent of the
/// map provider. Production defaults to rendering tiles.
class MapTileConfig {
  MapTileConfig._();

  static bool enabled = true;
}
