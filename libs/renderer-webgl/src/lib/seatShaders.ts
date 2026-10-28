export const seatVertexShader = `#version 300 es
precision highp float;

in vec2 a_corner;
in vec2 a_position;
in float a_rotation;
in float a_symbolKind;
in float a_diameter;
in float a_status;
in float a_selected;
in vec4 a_fillColor;
in vec4 a_strokeColor;

uniform vec2 u_resolution;
uniform vec3 u_viewport;

out vec2 v_local;
out float v_symbolKind;
out float v_diameterPixels;
out float v_status;
out float v_selected;
out vec4 v_fillColor;
out vec4 v_strokeColor;

void main() {
  vec2 local = a_corner * (a_diameter * 0.5 + 0.09);
  float cosine = cos(a_rotation);
  float sine = sin(a_rotation);
  vec2 rotated = vec2(
    local.x * cosine - local.y * sine,
    local.x * sine + local.y * cosine
  );
  vec2 screen = a_position * u_viewport.z + rotated * u_viewport.z + u_viewport.xy;
  vec2 clip = vec2(2.0 * screen.x / u_resolution.x - 1.0, 1.0 - 2.0 * screen.y / u_resolution.y);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_local = local;
  v_symbolKind = a_symbolKind;
  v_diameterPixels = a_diameter * u_viewport.z;
  v_status = a_status;
  v_selected = a_selected;
  v_fillColor = a_fillColor;
  v_strokeColor = a_strokeColor;
}
`;

export const seatFragmentShader = `#version 300 es
precision highp float;

uniform vec4 u_selectedColor;

in vec2 v_local;
in float v_symbolKind;
in float v_diameterPixels;
in float v_status;
in float v_selected;
in vec4 v_fillColor;
in vec4 v_strokeColor;
out vec4 outColor;

bool insideRect(vec2 point, vec2 minimum, vec2 maximum, float expansion) {
  return point.x >= minimum.x - expansion && point.x <= maximum.x + expansion &&
         point.y >= minimum.y - expansion && point.y <= maximum.y + expansion;
}

bool seatShape(float symbolKind, vec2 point, float expansion) {
  if (symbolKind > 1.5) {
    return insideRect(point, vec2(-0.8, -0.8), vec2(0.8, 0.8), expansion);
  }
  if (symbolKind > 0.5) {
    return insideRect(point, vec2(-0.55, -0.55), vec2(0.55, 0.65), expansion) ||
           insideRect(point, vec2(-0.75, -0.75), vec2(0.75, -0.52), expansion) ||
           insideRect(point, vec2(-0.75, -0.5), vec2(-0.55, 0.5), expansion) ||
           insideRect(point, vec2(0.55, -0.5), vec2(0.75, 0.5), expansion);
  }
  return insideRect(point, vec2(-0.55, -0.48), vec2(0.55, 0.55), expansion) ||
         insideRect(point, vec2(-0.65, -0.75), vec2(0.65, -0.48), expansion) ||
         insideRect(point, vec2(-0.4, 0.55), vec2(0.4, 0.75), expansion);
}

bool seatSilhouette(float symbolKind, vec2 point, float expansion) {
  if (symbolKind > 1.5) {
    return insideRect(point, vec2(-0.8, -0.8), vec2(0.8, 0.8), expansion);
  }
  return insideRect(point, vec2(-0.5, -0.42), vec2(0.5, 0.55), expansion) ||
         insideRect(point, vec2(-0.6, -0.75), vec2(0.6, -0.42), expansion);
}

float segmentDistance(vec2 point, vec2 start, vec2 end) {
  vec2 segment = end - start;
  float lengthSquared = dot(segment, segment);
  float position = lengthSquared > 0.0
    ? clamp(dot(point - start, segment) / lengthSquared, 0.0, 1.0)
    : 0.0;
  return distance(point, start + segment * position);
}

bool wheelchairGlyph(vec2 point) {
  return distance(point, vec2(0.0, -0.42)) < 0.16 ||
         segmentDistance(point, vec2(0.0, -0.22), vec2(0.0, 0.22)) < 0.055 ||
         segmentDistance(point, vec2(0.0, 0.22), vec2(0.32, 0.22)) < 0.055 ||
         abs(distance(point, vec2(-0.08, 0.27)) - 0.34) < 0.055;
}

bool wheelchairDashVisible(vec2 point) {
  float sidePosition = abs(point.x) > abs(point.y) ? point.y : point.x;
  return mod(sidePosition + 0.8, 0.32) < 0.2;
}

vec4 statusColor(float status) {
  if (status > 3.5) return vec4(0.647, 0.678, 0.714, 1.0);
  if (status > 2.5) return vec4(0.404, 0.443, 0.494, 1.0);
  if (status > 1.5) return vec4(0.604, 0.267, 0.314, 1.0);
  if (status > 0.5) return vec4(0.725, 0.471, 0.098, 1.0);
  return vec4(0.094, 0.471, 0.290, 1.0);
}

void main() {
  bool dotMode = v_diameterPixels < 6.0;
  bool silhouetteMode = v_diameterPixels < 22.0;
  float expansion = 0.0;
  bool inside = dotMode
    ? length(v_local) <= 0.38
    : (silhouetteMode
      ? seatSilhouette(v_symbolKind, v_local, expansion)
      : seatShape(v_symbolKind, v_local, expansion));
  bool expanded = v_selected > 0.5 && dotMode && length(v_local) <= 0.45;
  if (!inside && !expanded) discard;
  bool inner = dotMode
    ? length(v_local) <= 0.31
    : (silhouetteMode
      ? seatSilhouette(v_symbolKind, v_local, -0.06)
      : seatShape(v_symbolKind, v_local, -0.06));
  bool stroke = !dotMode && inside && !inner;
  bool wheelchair = v_symbolKind > 1.5;
  bool wheelchairDash = !wheelchair || wheelchairDashVisible(v_local);
  if (expanded && !inside)
    outColor = u_selectedColor;
  else if (
    stroke &&
    wheelchairDash &&
    (v_selected > 0.5 || v_strokeColor.a > 0.5)
  )
    outColor = v_selected > 0.5
      ? u_selectedColor
      : vec4(v_strokeColor.rgb, 1.0);
  else if (wheelchair && !silhouetteMode && !dotMode && wheelchairGlyph(v_local))
    outColor = vec4(v_strokeColor.rgb, 1.0);
  else if (v_fillColor.a <= 0.5 && !dotMode && v_status > 1.5 &&
           (abs(v_local.x - v_local.y) < 0.045 || abs(v_local.x + v_local.y) < 0.045))
    outColor = vec4(0.12, 0.16, 0.18, 1.0);
  else
    outColor = vec4(
      v_fillColor.a > 0.5 ? v_fillColor.rgb : statusColor(v_status).rgb,
      1.0
    );
}
`;
