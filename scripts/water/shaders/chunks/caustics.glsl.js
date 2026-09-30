export const CAUSTICS_CHUNK = `
    // Voronoi caustic pattern with orbital cell jitter
    float voronoiCaustic(vec2 uv, float t) {
        vec2 i = floor(uv);
        vec2 f = fract(uv);
        float minDist1 = 8.0;
        float minDist2 = 8.0;

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 point = hash22(i + neighbor);
                vec2 jitter = vec2(
                    sin(t * 0.18 + point.y * 6.2831),
                    cos(t * 0.14 + point.x * 6.2831)
                );
                point = 0.5 + 0.38 * jitter;
                float d = length(neighbor + point - f);
                if (d < minDist1) {
                    minDist2 = minDist1;
                    minDist1 = d;
                } else if (d < minDist2) {
                    minDist2 = d;
                }
            }
        }
        return minDist2 - minDist1;
    }

    // 2D distortion vector from noise
    vec2 distortionOffset(vec2 uv, float t) {
        float nx = noise21(uv * 2.0 + vec2(t * 0.3, t * 0.2)) - 0.5;
        float ny = noise21(uv * 2.0 + vec2(t * 0.2, -t * 0.3) + 50.0) - 0.5;
        return vec2(nx, ny);
    }
`;
