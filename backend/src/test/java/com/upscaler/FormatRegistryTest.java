package com.upscaler;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.imageio.*;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.metadata.IIOMetadataNode;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FormatRegistryTest {

    @ParameterizedTest
    @ValueSource(strings = {"png", "jpeg", "bmp", "webp", "tiff"})
    void testFormatHasReaderAndWriter(String format) {
        Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName(format);
        List<String> readerNames = new ArrayList<>();
        while (readers.hasNext()) {
            readerNames.add(readers.next().getClass().getName());
        }

        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName(format);
        List<String> writerNames = new ArrayList<>();
        while (writers.hasNext()) {
            writerNames.add(writers.next().getClass().getName());
        }

        System.out.printf("Format [%s]: Readers=%s, Writers=%s%n", format, readerNames, writerNames);

        assertFalse(readerNames.isEmpty(), "Should have at least one reader for " + format);
        assertFalse(writerNames.isEmpty(), "Should have at least one writer for " + format);
    }

    @Test
    void testPngTransparencyAndDpiMetadata() throws Exception {
        BufferedImage img = new BufferedImage(50, 50, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setColor(new Color(255, 0, 0, 255));
        g.fillRect(25, 25, 25, 25);
        g.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("png");
        assertTrue(writers.hasNext(), "PNG writer must exist");
        ImageWriter writer = writers.next();

        try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
            writer.setOutput(mcios);
            ImageWriteParam param = writer.getDefaultWriteParam();
            ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(img);
            IIOMetadata meta = writer.getDefaultImageMetadata(spec, param);

            int targetDpi = 300;
            int ppm = (int) Math.round(targetDpi / 0.0254);
            IIOMetadataNode nativeRoot = new IIOMetadataNode("javax_imageio_png_1.0");
            IIOMetadataNode phys = new IIOMetadataNode("pHYs");
            phys.setAttribute("pixelsPerUnitXAxis", Integer.toString(ppm));
            phys.setAttribute("pixelsPerUnitYAxis", Integer.toString(ppm));
            phys.setAttribute("unitSpecifier", "meter");
            nativeRoot.appendChild(phys);
            meta.mergeTree("javax_imageio_png_1.0", nativeRoot);

            writer.write(null, new IIOImage(img, null, meta), param);
        } finally {
            writer.dispose();
        }

        assertTrue(baos.size() > 0, "PNG output must not be empty");

        // Read back and verify transparency & DPI
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(baos.toByteArray()))) {
            ImageReader reader = ImageIO.getImageReaders(iis).next();
            reader.setInput(iis);
            BufferedImage readImg = reader.read(0);

            // Transparency check at 10,10 (top-left is transparent)
            int alpha = (readImg.getRGB(10, 10) >> 24) & 0xff;
            assertEquals(0, alpha, "Top-left pixel must be fully transparent");

            // DPI check
            IIOMetadata readMeta = reader.getImageMetadata(0);
            Node standardTree = readMeta.getAsTree("javax_imageio_1.0");
            NodeList list = ((Element) standardTree).getElementsByTagName("HorizontalPixelSize");
            assertTrue(list.getLength() > 0, "DPI HorizontalPixelSize metadata must exist");
            float sizeMm = Float.parseFloat(((Element) list.item(0)).getAttribute("value"));
            int dpi = Math.round(25.4f / sizeMm);
            assertEquals(300, dpi, "PNG must retain 300 DPI metadata");
            reader.dispose();
        }
    }

    @Test
    void testJpegCompressionQualityAndJfifDpi() throws Exception {
        BufferedImage img = new BufferedImage(50, 50, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.BLUE);
        g.fillRect(0, 0, 50, 50);
        g.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
        assertTrue(writers.hasNext(), "JPEG writer must exist");
        ImageWriter writer = writers.next();

        try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
            writer.setOutput(mcios);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(0.85f);

            ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(img);
            IIOMetadata meta = writer.getDefaultImageMetadata(spec, param);

            int targetDpi = 300;
            IIOMetadataNode root = new IIOMetadataNode("javax_imageio_jpeg_image_1.0");
            IIOMetadataNode variety = new IIOMetadataNode("JPEGvariety");
            IIOMetadataNode jfif = new IIOMetadataNode("app0JFIF");
            jfif.setAttribute("majorVersion", "1");
            jfif.setAttribute("minorVersion", "2");
            jfif.setAttribute("resUnits", "1"); // 1 = dots per inch
            jfif.setAttribute("Xdensity", Integer.toString(targetDpi));
            jfif.setAttribute("Ydensity", Integer.toString(targetDpi));
            jfif.setAttribute("thumbWidth", "0");
            jfif.setAttribute("thumbHeight", "0");
            variety.appendChild(jfif);
            root.appendChild(variety);
            IIOMetadataNode markerSequence = new IIOMetadataNode("markerSequence");
            root.appendChild(markerSequence);
            meta.mergeTree("javax_imageio_jpeg_image_1.0", root);

            writer.write(null, new IIOImage(img, null, meta), param);
        } finally {
            writer.dispose();
        }

        assertTrue(baos.size() > 0, "JPEG output must not be empty");

        // Read back and verify DPI
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(baos.toByteArray()))) {
            ImageReader reader = ImageIO.getImageReaders(iis).next();
            reader.setInput(iis);
            IIOMetadata readMeta = reader.getImageMetadata(0);
            Node standardTree = readMeta.getAsTree("javax_imageio_1.0");
            NodeList list = ((Element) standardTree).getElementsByTagName("HorizontalPixelSize");
            assertTrue(list.getLength() > 0, "DPI metadata must exist");
            float sizeMm = Float.parseFloat(((Element) list.item(0)).getAttribute("value"));
            int dpi = Math.round(25.4f / sizeMm);
            assertEquals(300, dpi, "JPEG must retain 300 DPI metadata");
            reader.dispose();
        }
    }

    @Test
    void testBmpOutputBytesAndDecoding() throws Exception {
        BufferedImage img = new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.GREEN);
        g.fillRect(0, 0, 32, 32);
        g.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        boolean written = ImageIO.write(img, "bmp", baos);
        assertTrue(written, "BMP must be written successfully");
        assertTrue(baos.size() > 0, "BMP bytes must not be empty");

        BufferedImage readImg = ImageIO.read(new ByteArrayInputStream(baos.toByteArray()));
        assertNotNull(readImg, "BMP must decode successfully");
        assertEquals(32, readImg.getWidth());
        assertEquals(32, readImg.getHeight());
    }

    @Test
    void testWebpWriterReaderAndTransparency() throws Exception {
        BufferedImage img = new BufferedImage(40, 40, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        // Transparent top half, opaque bottom half
        g.setColor(new Color(0, 0, 255, 255));
        g.fillRect(0, 20, 40, 20);
        g.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("webp");
        assertTrue(writers.hasNext(), "WebP writer must be available");
        ImageWriter writer = writers.next();

        try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
            writer.setOutput(mcios);
            writer.write(new IIOImage(img, null, null));
        } finally {
            writer.dispose();
        }

        assertTrue(baos.size() > 0, "WebP bytes must not be empty");

        // Read back with WebP reader
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(baos.toByteArray()))) {
            Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName("webp");
            assertTrue(readers.hasNext(), "WebP reader must be available");
            ImageReader reader = readers.next();
            reader.setInput(iis);
            BufferedImage readImg = reader.read(0);

            assertNotNull(readImg, "WebP must decode successfully");
            assertEquals(40, readImg.getWidth());
            assertEquals(40, readImg.getHeight());

            // Check transparency preserved (top-half alpha = 0)
            int alphaTop = (readImg.getRGB(10, 10) >> 24) & 0xff;
            assertEquals(0, alphaTop, "WebP must preserve alpha transparency");
            reader.dispose();
        }
    }

    @Test
    void testWebpWriterMetadataSupport() {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("webp");
        assertTrue(writers.hasNext(), "WebP writer must be registered");
        ImageWriter writer = writers.next();
        BufferedImage img = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(img);
        IIOMetadata meta = writer.getDefaultImageMetadata(spec, writer.getDefaultWriteParam());
        // WebP ImageWriter does not support ImageIO IIOMetadata manipulation (returns null)
        assertNull(meta, "WebP ImageIO plugin does not support dynamic IIOMetadata trees");
        writer.dispose();
    }

    @Test
    void testBmpWriterMetadataSupport() {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("bmp");
        assertTrue(writers.hasNext(), "BMP writer must be registered");
        ImageWriter writer = writers.next();
        BufferedImage img = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(img);
        IIOMetadata meta = writer.getDefaultImageMetadata(spec, writer.getDefaultWriteParam());
        assertNotNull(meta, "BMP ImageWriter metadata exists");
        // JDK BMP writer metadata is read-only; mergeTree throws IllegalStateException
        assertTrue(meta.isReadOnly(), "BMP writer metadata is read-only in JDK ImageIO");
        writer.dispose();
    }

    @Test
    void testTiffWriterReaderAndResolutionMetadata() throws Exception {
        BufferedImage img = new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.ORANGE);
        g.fillRect(0, 0, 32, 32);
        g.dispose();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("tiff");
        assertTrue(writers.hasNext(), "TIFF writer must be available");
        ImageWriter writer = writers.next();

        int targetDpi = 300;
        try (MemoryCacheImageOutputStream mcios = new MemoryCacheImageOutputStream(baos)) {
            writer.setOutput(mcios);
            ImageWriteParam param = writer.getDefaultWriteParam();
            ImageTypeSpecifier spec = ImageTypeSpecifier.createFromRenderedImage(img);
            IIOMetadata meta = writer.getDefaultImageMetadata(spec, param);

            if (meta != null) {
                IIOMetadataNode root = new IIOMetadataNode("com_sun_media_imageio_plugins_tiff_image_1.0");
                IIOMetadataNode ifd = new IIOMetadataNode("TIFFIFD");

                IIOMetadataNode xResField = new IIOMetadataNode("TIFFField");
                xResField.setAttribute("number", "282");
                xResField.setAttribute("name", "XResolution");
                IIOMetadataNode xRationals = new IIOMetadataNode("TIFFRationals");
                IIOMetadataNode xRational = new IIOMetadataNode("TIFFRational");
                xRational.setAttribute("value", targetDpi + "/1");
                xRationals.appendChild(xRational);
                xResField.appendChild(xRationals);
                ifd.appendChild(xResField);

                IIOMetadataNode yResField = new IIOMetadataNode("TIFFField");
                yResField.setAttribute("number", "283");
                yResField.setAttribute("name", "YResolution");
                IIOMetadataNode yRationals = new IIOMetadataNode("TIFFRationals");
                IIOMetadataNode yRational = new IIOMetadataNode("TIFFRational");
                yRational.setAttribute("value", targetDpi + "/1");
                yRationals.appendChild(yRational);
                yResField.appendChild(yRationals);
                ifd.appendChild(yResField);

                IIOMetadataNode unitField = new IIOMetadataNode("TIFFField");
                unitField.setAttribute("number", "296");
                unitField.setAttribute("name", "ResolutionUnit");
                IIOMetadataNode unitShorts = new IIOMetadataNode("TIFFShorts");
                IIOMetadataNode unitShort = new IIOMetadataNode("TIFFShort");
                unitShort.setAttribute("value", "2"); // 2 = Inch
                unitShorts.appendChild(unitShort);
                unitField.appendChild(unitShorts);
                ifd.appendChild(unitField);

                root.appendChild(ifd);
                try {
                    meta.mergeTree("com_sun_media_imageio_plugins_tiff_image_1.0", root);
                } catch (Exception e) {
                    System.out.println("mergeTree native failed: " + e.getMessage());
                }
            }

            writer.write(null, new IIOImage(img, null, meta), param);
        } finally {
            writer.dispose();
        }

        assertTrue(baos.size() > 0, "TIFF bytes must not be empty");

        // Read back with TIFF reader
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(baos.toByteArray()))) {
            Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName("tiff");
            assertTrue(readers.hasNext(), "TIFF reader must be available");
            ImageReader reader = readers.next();
            reader.setInput(iis);
            BufferedImage readImg = reader.read(0);

            assertNotNull(readImg, "TIFF must decode successfully");
            assertEquals(32, readImg.getWidth());
            assertEquals(32, readImg.getHeight());

            IIOMetadata readMeta = reader.getImageMetadata(0);
            assertNotNull(readMeta, "TIFF reader metadata must not be null");
            Node standardTree = readMeta.getAsTree("javax_imageio_1.0");
            assertNotNull(standardTree, "TIFF standard metadata tree must not be null");
            NodeList list = ((Element) standardTree).getElementsByTagName("HorizontalPixelSize");
            assertTrue(list.getLength() > 0, "DPI metadata must exist in TIFF standard tree");
            float sizeMm = Float.parseFloat(((Element) list.item(0)).getAttribute("value"));
            int dpi = Math.round(25.4f / sizeMm);
            assertEquals(300, dpi, "TIFF must retain 300 DPI metadata");

            reader.dispose();
        }
    }
}
