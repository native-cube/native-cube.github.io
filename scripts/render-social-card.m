#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>


int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      fprintf(stderr, "Usage: render-social-card INPUT.svg OUTPUT.png\n");
      return 2;
    }

    NSString *inputPath = [NSString stringWithUTF8String:argv[1]];
    NSString *outputPath = [NSString stringWithUTF8String:argv[2]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:inputPath];
    if (image == nil) {
      fprintf(stderr, "Could not load %s\n", argv[1]);
      return 1;
    }

    const NSInteger width = 1200;
    const NSInteger height = 630;
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
      initWithBitmapDataPlanes:NULL
      pixelsWide:width
      pixelsHigh:height
      bitsPerSample:8
      samplesPerPixel:4
      hasAlpha:YES
      isPlanar:NO
      colorSpaceName:NSDeviceRGBColorSpace
      bytesPerRow:0
      bitsPerPixel:0
    ];
    if (bitmap == nil) {
      fprintf(stderr, "Could not allocate the PNG canvas\n");
      return 1;
    }

    bitmap.size = NSMakeSize(width, height);
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    [NSGraphicsContext setCurrentContext:context];
    [[NSColor whiteColor] setFill];
    NSRectFill(NSMakeRect(0, 0, width, height));
    [image drawInRect:NSMakeRect(0, 0, width, height)
             fromRect:NSZeroRect
            operation:NSCompositingOperationSourceOver
             fraction:1.0
       respectFlipped:YES
                hints:@{NSImageHintInterpolation: @(NSImageInterpolationHigh)}];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];

    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (png == nil || ![png writeToFile:outputPath atomically:YES]) {
      fprintf(stderr, "Could not write %s\n", argv[2]);
      return 1;
    }

    printf("Rendered %s at 1200x630\n", argv[2]);
  }
  return 0;
}
