export const seatVertexShader = `#version 300 es
precision highp float;

in vec2 a_corner;
in vec2 a_position;
in float a_rotation;
in float a_symbolKind;
in float a_diameter;
in float a_status;
in float a_selected;

uniform vec2 u_resolution;
uniform vec3 u_viewport;

out vec2 v_local;
out float v_symbolKind;
out float v_diameterPixels;
out float v_status;
out float v_selected;

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
}
`;

export const seatFragmentShader = `#version 300 es
precision highp float;

in vec2 v_local;
in float v_symbolKind;
in float v_diameterPixels;
in float v_status;
in float v_selected;
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

vec4 statusColor(float status) {
  if (status > 3.5) return vec4(0.47, 0.51, 0.56, 1.0);
  if (status > 2.5) return vec4(0.39, 0.43, 0.48, 1.0);
  if (status > 1.5) return vec4(0.63, 0.29, 0.31, 1.0);
  if (status > 0.5) return vec4(0.94, 0.62, 0.18, 1.0);
  return vec4(0.18, 0.55, 0.42, 1.0);
}

void main() {
  bool dotMode = v_diameterPixels < 6.0;
  bool silhouetteMode = v_diameterPixels < 22.0;
  float expansion = v_selected > 0.5 ? 0.055 : 0.0;
  bool inside = dotMode
    ? length(v_local) <= 0.38
    : (silhouetteMode
      ? seatSilhouette(v_symbolKind, v_local, expansion)
      : seatShape(v_symbolKind, v_local, expansion));
  bool expanded = v_selected > 0.5 && (dotMode
    ? length(v_local) <= 0.45
    : seatShape(v_symbolKind, v_local, expansion + 0.07));
  if (!inside && !expanded) discard;
  if (expanded && !inside) outColor = vec4(0.10, 0.32, 0.82, 1.0);
  else if (!dotMode && v_status > 1.5 &&
           (abs(v_local.x - v_local.y) < 0.045 || abs(v_local.x + v_local.y) < 0.045))
    outColor = vec4(0.12, 0.16, 0.18, 1.0);
  else outColor = statusColor(v_status);
}
`;
