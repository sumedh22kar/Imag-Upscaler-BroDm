package com.upscaler.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    @Value("${server.port:8808}")
    private int serverPort;

    @Value("${spring.application.name:image-upscaler-backend}")
    private String applicationName;

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "UP");
        response.put("application", applicationName);
        response.put("port", serverPort);
        response.put("message", "Image Upscaler backend is running healthy on port " + serverPort);
        response.put("javaVersion", System.getProperty("java.version"));
        response.put("jvmUptimeMs", ManagementFactory.getRuntimeMXBean().getUptime());
        response.put("timestamp", Instant.now().toString());

        return ResponseEntity.ok(response);
    }
}
