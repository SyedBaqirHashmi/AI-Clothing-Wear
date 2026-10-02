/** A regular grid mesh over the unit square: positions (u,v) and triangle indices. */
export interface GridMesh {
  uv: Float32Array;
  indices: Uint16Array;
  cols: number;
  rows: number;
}

export function makeGrid(cols: number, rows: number): GridMesh {
  const uv = new Float32Array((cols + 1) * (rows + 1) * 2);
  let n = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      uv[n++] = c / cols;
      uv[n++] = r / rows;
    }
  }
  const indices = new Uint16Array(cols * rows * 6);
  n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices[n++] = a;
      indices[n++] = d;
      indices[n++] = b;
      indices[n++] = b;
      indices[n++] = d;
      indices[n++] = e;
    }
  }
  return { uv, indices, cols, rows };
}
