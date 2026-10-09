package com.upscaler;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PrintSizeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void testA4PortraitAt300Dpi() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("preset", "A4")
                        .param("orientation", "portrait")
                        .param("dpi", "300"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preset").value("A4"))
                .andExpect(jsonPath("$.orientation").value("portrait"))
                .andExpect(jsonPath("$.dpi").value(300))
                .andExpect(jsonPath("$.widthPx").value(2480))
                .andExpect(jsonPath("$.heightPx").value(3508));
    }

    @Test
    void testA4LandscapeAt300Dpi() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("preset", "A4")
                        .param("orientation", "landscape")
                        .param("dpi", "300"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preset").value("A4"))
                .andExpect(jsonPath("$.orientation").value("landscape"))
                .andExpect(jsonPath("$.dpi").value(300))
                .andExpect(jsonPath("$.widthPx").value(3508))
                .andExpect(jsonPath("$.heightPx").value(2480));
    }

    @Test
    void testA3PortraitAt300Dpi() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("preset", "A3")
                        .param("orientation", "portrait")
                        .param("dpi", "300"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preset").value("A3"))
                .andExpect(jsonPath("$.orientation").value("portrait"))
                .andExpect(jsonPath("$.dpi").value(300))
                .andExpect(jsonPath("$.widthPx").value(3508))
                .andExpect(jsonPath("$.heightPx").value(4961));
    }

    @Test
    void testCustom10x15At300Dpi() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("widthCm", "10")
                        .param("heightCm", "15")
                        .param("dpi", "300"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preset").value("CUSTOM"))
                .andExpect(jsonPath("$.orientation").value("custom"))
                .andExpect(jsonPath("$.dpi").value(300))
                .andExpect(jsonPath("$.widthPx").value(1181))
                .andExpect(jsonPath("$.heightPx").value(1772));
    }

    @Test
    void testUnsupportedPresetReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("preset", "UNKNOWN")
                        .param("dpi", "300"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void testInvalidDpiReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("preset", "A4")
                        .param("dpi", "50"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void testBothPresetAndCustomDimensionsReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("preset", "A4")
                        .param("widthCm", "10")
                        .param("heightCm", "15"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void testMissingBothReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void testPartialCustomDimensionsReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/images/print-sizes")
                        .param("widthCm", "10"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }
}
