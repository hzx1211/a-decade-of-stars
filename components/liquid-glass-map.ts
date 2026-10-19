/** Encode the outward normal of a rounded lens in RG. Its flat centre is
 * neutral (128,128); only the curved lip displaces a backdrop pixel. */
export function buildLensDisplacement(width: number, height: number, radius: number, lip: number) {
  const scale = Math.min(1, 640 / width, 480 / height);
  const mapWidth = Math.max(2, Math.round(width * scale));
  const mapHeight = Math.max(2, Math.round(height * scale));
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const cornerRadius = Math.max(0, Math.min(radius, halfWidth, halfHeight));
  for (let y = 0; y < mapHeight; y++) {
    const pointY = (y + .5) / mapHeight * height - halfHeight;
    const qy = Math.abs(pointY) - (halfHeight - cornerRadius);
    for (let x = 0; x < mapWidth; x++) {
      const pointX = (x + .5) / mapWidth * width - halfWidth;
      const qx = Math.abs(pointX) - (halfWidth - cornerRadius);
      const outsideX = Math.max(qx, 0);
      const outsideY = Math.max(qy, 0);
      const cornerDistance = Math.hypot(outsideX, outsideY);
      const depth = -(cornerDistance + Math.min(Math.max(qx, qy), 0) - cornerRadius);
      let normalX = 0;
      let normalY = 0;
      if (cornerDistance > 0) {
        normalX = Math.sign(pointX) * outsideX / cornerDistance;
        normalY = Math.sign(pointY) * outsideY / cornerDistance;
      } else if (qx > qy) normalX = Math.sign(pointX);
      else normalY = Math.sign(pointY);
      const bend = depth > 0 && depth < lip ? Math.sin(Math.PI * depth / lip) * 104 : 0;
      const offset = (y * mapWidth + x) * 4;
      data[offset] = Math.round(128 + normalX * bend);
      data[offset + 1] = Math.round(128 + normalY * bend);
      data[offset + 2] = 128;
      data[offset + 3] = 255;
    }
  }
  return { width: mapWidth, height: mapHeight, data };
}
