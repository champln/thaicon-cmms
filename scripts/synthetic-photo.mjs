// Small visible PNG test fixture, not customer data or a user image edit.
import { deflateSync } from 'node:zlib';
function chunk(type, data) {
  const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,bytes,checksum]);
}
const width=32,height=24,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
const pixels=Buffer.alloc(height*(width*3+1));
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const offset=y*(width*3+1)+1+x*3,color=(Math.floor(x/8)+Math.floor(y/8))%2?[18,98,163]:[40,190,130];
  for(let channel=0;channel<3;channel++)pixels[offset+channel]=color[channel];
}
export const syntheticPhoto=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
