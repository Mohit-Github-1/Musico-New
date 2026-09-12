/**
 * Musico - ID3 & Audio Metadata Parser (High-Speed & Low-Memory Optimized)
 * Optimized slicing, fast header inspection, and smart image compression.
 */

const ID3Parser = {
  /**
   * Fast cover compression only for very large raw images (>150KB)
   */
  async compressImageBlob(rawBlob, maxDim = 320) {
    if (!rawBlob || rawBlob.size < 150000) return rawBlob; // Already lightweight, skip canvas overhead
    try {
      if ('createImageBitmap' in window) {
        const bitmap = await createImageBitmap(rawBlob);
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        if (scale >= 1) {
          bitmap.close();
          return rawBlob;
        }
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, w, h);
          bitmap.close();
          return new Promise((resolve) => {
            canvas.toBlob((resizedBlob) => {
              resolve(resizedBlob || rawBlob);
            }, 'image/jpeg', 0.80);
          });
        }
        bitmap.close();
      }
    } catch (e) {
      // Silently return rawBlob if compression fails
    }
    return rawBlob;
  },

  /**
   * Parse metadata with minimal I/O slicing
   * @param {File|Blob} file 
   * @returns {Promise<Object>} Metadata object
   */
  async parse(file) {
    const fallback = this.getFallbackMetadata(file.name || 'Unknown Track');
    try {
      const lowerName = (file.name || '').toLowerCase();

      // 1. Fast ID3v2 inspection (Read 10 bytes first to get exact tag size)
      if (file.size >= 10) {
        const header10Buffer = await file.slice(0, 10).arrayBuffer();
        const view10 = new DataView(header10Buffer);
        const isID3 = String.fromCharCode(view10.getUint8(0), view10.getUint8(1), view10.getUint8(2)) === 'ID3';

        if (isID3) {
          const tagSize = this.readSynchsafeInt(view10, 6);
          const fullTagSize = Math.min(file.size, 10 + tagSize);
          // Slice only the exact ID3 tag buffer
          const id3Buffer = await file.slice(0, fullTagSize).arrayBuffer();
          const id3v2 = this.parseID3v2(id3Buffer);

          if (id3v2 && (id3v2.title || id3v2.artist || id3v2.coverBlob)) {
            let coverBlob = id3v2.coverBlob;
            let coverUrl = null;
            if (coverBlob) {
              coverBlob = await this.compressImageBlob(coverBlob, 320);
              coverUrl = URL.createObjectURL(coverBlob);
            }

            return {
              title: id3v2.title || fallback.title,
              artist: id3v2.artist || fallback.artist,
              album: id3v2.album || fallback.album,
              year: id3v2.year || '',
              lyrics: id3v2.lyrics || '',
              coverUrl: coverUrl,
              coverBlob: coverBlob,
              duration: 0
            };
          }
        }
      }

      // 2. FLAC / OGG tags
      if (lowerName.endsWith('.flac') || lowerName.endsWith('.ogg')) {
        const flacBuffer = await file.slice(0, Math.min(file.size, 131072)).arrayBuffer();
        const flacMeta = this.parseFLAC(flacBuffer);
        if (flacMeta) {
          let coverBlob = flacMeta.coverBlob;
          let coverUrl = null;
          if (coverBlob) {
            coverBlob = await this.compressImageBlob(coverBlob, 320);
            coverUrl = URL.createObjectURL(coverBlob);
          }
          return {
            title: flacMeta.title || fallback.title,
            artist: flacMeta.artist || fallback.artist,
            album: flacMeta.album || fallback.album,
            year: flacMeta.year || '',
            coverUrl: coverUrl,
            coverBlob: coverBlob,
            duration: 0
          };
        }
      }

      // 3. M4A / MP4 tags
      if (lowerName.endsWith('.m4a') || lowerName.endsWith('.aac') || lowerName.endsWith('.mp4')) {
        const m4aBuffer = await file.slice(0, Math.min(file.size, 131072)).arrayBuffer();
        const m4aMeta = this.parseM4A(m4aBuffer);
        if (m4aMeta) {
          let coverBlob = m4aMeta.coverBlob;
          let coverUrl = null;
          if (coverBlob) {
            coverBlob = await this.compressImageBlob(coverBlob, 320);
            coverUrl = URL.createObjectURL(coverBlob);
          }
          return {
            title: m4aMeta.title || fallback.title,
            artist: m4aMeta.artist || fallback.artist,
            album: m4aMeta.album || fallback.album,
            year: m4aMeta.year || '',
            coverUrl: coverUrl,
            coverBlob: coverBlob,
            duration: 0
          };
        }
      }

      // 4. ID3v1 (last 128 bytes)
      if (file.size > 128) {
        const footerBuffer = await file.slice(file.size - 128).arrayBuffer();
        const id3v1 = this.parseID3v1(footerBuffer);
        if (id3v1 && (id3v1.title || id3v1.artist)) {
          return {
            title: id3v1.title || fallback.title,
            artist: id3v1.artist || fallback.artist,
            album: id3v1.album || fallback.album,
            year: id3v1.year || '',
            coverUrl: null,
            coverBlob: null,
            duration: 0
          };
        }
      }

      return fallback;
    } catch (err) {
      return fallback;
    }
  },

  /**
   * Parse ID3v2 headers and frames (v2.2, v2.3, v2.4)
   */
  parseID3v2(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 10) return null;

    const id3 = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
    if (id3 !== 'ID3') return null;

    const majorVersion = view.getUint8(3);
    const tagSize = this.readSynchsafeInt(view, 6);
    let offset = 10;
    const maxOffset = Math.min(buffer.byteLength, 10 + tagSize);

    const result = {
      title: '',
      artist: '',
      album: '',
      year: '',
      lyrics: '',
      coverBlob: null
    };

    // ID3v2.2
    if (majorVersion === 2) {
      while (offset < maxOffset - 6) {
        let frameId = '';
        for (let i = 0; i < 3; i++) {
          const charCode = view.getUint8(offset + i);
          if (charCode >= 32 && charCode <= 126) frameId += String.fromCharCode(charCode);
        }
        if (frameId.length < 3) break;

        const frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
        if (frameSize <= 0 || offset + 6 + frameSize > maxOffset) break;

        const frameBuffer = buffer.slice(offset + 6, offset + 6 + frameSize);
        if (frameId === 'TT2') result.title = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'TP1') result.artist = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'TAL') result.album = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'TYE') result.year = this.decodeTextFrame(frameBuffer);
        else if (frameId === 'ULT') result.lyrics = this.decodeLyricsFrame(frameBuffer);
        else if (frameId === 'PIC' && !result.coverBlob) {
          const apic = this.decodeAPICFrame(frameBuffer);
          if (apic && apic.coverBlob) result.coverBlob = apic.coverBlob;
        }

        offset += 6 + frameSize;
      }
      return result;
    }

    // ID3v2.3 & ID3v2.4
    while (offset < maxOffset - 10) {
      let frameId = '';
      for (let i = 0; i < 4; i++) {
        const charCode = view.getUint8(offset + i);
        if (charCode >= 32 && charCode <= 126) {
          frameId += String.fromCharCode(charCode);
        }
      }

      if (frameId.length < 4) break;

      let frameSize = 0;
      if (majorVersion === 4) {
        frameSize = this.readSynchsafeInt(view, offset + 4);
      } else {
        frameSize = view.getUint32(offset + 4);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > maxOffset) break;

      const frameDataOffset = offset + 10;
      const frameBuffer = buffer.slice(frameDataOffset, frameDataOffset + frameSize);

      if (frameId === 'TIT2') {
        result.title = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'TPE1' || frameId === 'TPE2') {
        if (!result.artist) result.artist = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'TALB') {
        result.album = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'TYER' || frameId === 'TDRC') {
        result.year = this.decodeTextFrame(frameBuffer);
      } else if (frameId === 'USLT') {
        result.lyrics = this.decodeLyricsFrame(frameBuffer);
      } else if (frameId === 'APIC' && !result.coverBlob) {
        const apic = this.decodeAPICFrame(frameBuffer);
        if (apic && apic.coverBlob) {
          result.coverBlob = apic.coverBlob;
        }
      }

      offset += 10 + frameSize;
    }

    return result;
  },

  /**
   * Decode USLT / ULT unsynchronized lyrics frame
   */
  decodeLyricsFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 5) return '';
      const encoding = bytes[0];
      // Skip 3-byte language code (bytes[1..3])
      let offset = 4;
      // Skip content descriptor null-terminated string
      if (encoding === 0 || encoding === 3) {
        while (offset < bytes.length && bytes[offset] !== 0) offset++;
        offset++;
      } else {
        while (offset < bytes.length - 1 && !(bytes[offset] === 0 && bytes[offset + 1] === 0)) {
          offset += 2;
        }
        offset += 2;
      }
      if (offset >= bytes.length) return '';
      const textBytes = bytes.slice(offset);
      if (encoding === 0) {
        let str = '';
        for (let i = 0; i < textBytes.length; i++) {
          if (textBytes[i] === 0) continue;
          str += String.fromCharCode(textBytes[i]);
        }
        return str.trim();
      } else if (encoding === 1 || encoding === 2) {
        return new TextDecoder('utf-16').decode(textBytes).replace(/\0/g, '').trim();
      } else if (encoding === 3) {
        return new TextDecoder('utf-8').decode(textBytes).replace(/\0/g, '').trim();
      }
      return new TextDecoder().decode(textBytes).replace(/\0/g, '').trim();
    } catch (e) {
      return '';
    }
  },

  /**
   * Decode APIC (Attached Picture) frame to Blob
   */
  decodeAPICFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 10) return null;

      const encoding = bytes[0];
      let offset = 1;

      // Read MIME type
      let mimeType = '';
      while (offset < bytes.length && bytes[offset] !== 0) {
        mimeType += String.fromCharCode(bytes[offset]);
        offset++;
      }
      offset++; // skip null terminator

      if (!mimeType || mimeType === 'image/') mimeType = 'image/jpeg';

      const pictureType = bytes[offset];
      offset++; // skip picture type

      // Skip description
      if (encoding === 0 || encoding === 3) {
        while (offset < bytes.length && bytes[offset] !== 0) offset++;
        offset++;
      } else {
        // UTF-16
        while (offset < bytes.length - 1 && !(bytes[offset] === 0 && bytes[offset + 1] === 0)) {
          offset += 2;
        }
        offset += 2;
      }

      if (offset >= bytes.length) return null;

      const imgBytes = bytes.slice(offset);
      const blob = new Blob([imgBytes], { type: mimeType });
      return {
        coverBlob: blob
      };
    } catch (e) {
      return null;
    }
  },

  /**
   * Parse FLAC Picture block
   */
  parseFLAC(buffer) {
    try {
      const view = new DataView(buffer);
      const str = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (str !== 'fLaC') return null;

      let offset = 4;
      let isLast = false;

      while (offset < buffer.byteLength - 4 && !isLast) {
        const header = view.getUint8(offset);
        isLast = (header & 0x80) !== 0;
        const blockType = header & 0x7F;
        const blockSize = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
        offset += 4;

        if (blockType === 6) {
          const mimeLen = view.getUint32(offset + 4);
          let mime = '';
          for (let i = 0; i < mimeLen; i++) {
            mime += String.fromCharCode(view.getUint8(offset + 8 + i));
          }
          const descLen = view.getUint32(offset + 8 + mimeLen);
          const dataOffset = offset + 8 + mimeLen + 4 + descLen + 16;
          const dataLen = view.getUint32(dataOffset - 4);

          const imgBytes = new Uint8Array(buffer, dataOffset, dataLen);
          const blob = new Blob([imgBytes], { type: mime || 'image/jpeg' });
          return { 
            coverBlob: blob
          };
        }
        offset += blockSize;
      }
    } catch (e) {
      // Silently ignore
    }
    return null;
  },

  /**
   * Parse M4A / MP4 covr atom
   */
  parseM4A(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length - 8; i++) {
        if (bytes[i] === 0x63 && bytes[i + 1] === 0x6F && bytes[i + 2] === 0x76 && bytes[i + 3] === 0x72) {
          let dataOffset = i + 4;
          while (dataOffset < bytes.length - 8) {
            if (bytes[dataOffset] === 0x64 && bytes[dataOffset + 1] === 0x61 && bytes[dataOffset + 2] === 0x74 && bytes[dataOffset + 3] === 0x61) {
              const dataLen = (bytes[dataOffset - 4] << 24) | (bytes[dataOffset - 3] << 16) | (bytes[dataOffset - 2] << 8) | bytes[dataOffset - 1];
              const imgStart = dataOffset + 12;
              const imgLen = dataLen - 16;
              if (imgStart + imgLen <= bytes.length) {
                const imgBytes = bytes.slice(imgStart, imgStart + imgLen);
                const blob = new Blob([imgBytes], { type: 'image/jpeg' });
                return { 
                  coverBlob: blob
                };
              }
            }
            dataOffset++;
          }
        }
      }
    } catch (e) {
      // Silently ignore
    }
    return null;
  },

  /**
   * Parse ID3v1 tags (last 128 bytes)
   */
  parseID3v1(buffer) {
    const bytes = new Uint8Array(buffer);
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag !== 'TAG') return null;

    const decode = (start, length) => {
      let str = '';
      for (let i = start; i < start + length; i++) {
        if (bytes[i] === 0) break;
        str += String.fromCharCode(bytes[i]);
      }
      return str.trim();
    };

    return {
      title: decode(3, 30),
      artist: decode(33, 30),
      album: decode(63, 30),
      year: decode(93, 4)
    };
  },

  /**
   * Decode text frame based on ID3 encoding byte
   */
  decodeTextFrame(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes.length === 0) return '';
      const encoding = bytes[0];
      const textBytes = bytes.slice(1);

      if (encoding === 0) {
        let str = '';
        for (let i = 0; i < textBytes.length; i++) {
          if (textBytes[i] === 0) break;
          str += String.fromCharCode(textBytes[i]);
        }
        return str.trim();
      } else if (encoding === 1 || encoding === 2) {
        return new TextDecoder('utf-16').decode(textBytes).replace(/\0/g, '').trim();
      } else if (encoding === 3) {
        return new TextDecoder('utf-8').decode(textBytes).replace(/\0/g, '').trim();
      }
      return new TextDecoder().decode(textBytes).replace(/\0/g, '').trim();
    } catch (e) {
      return '';
    }
  },

  /**
   * Synchsafe integer conversion
   */
  readSynchsafeInt(view, offset) {
    return (
      (view.getUint8(offset) & 0x7F) << 21 |
      (view.getUint8(offset + 1) & 0x7F) << 14 |
      (view.getUint8(offset + 2) & 0x7F) << 7 |
      (view.getUint8(offset + 3) & 0x7F)
    );
  },

  /**
   * Filename based fallback
   */
  getFallbackMetadata(filename) {
    const cleanName = filename.replace(/\.[^/.]+$/, '').trim();
    
    if (cleanName.includes(' - ')) {
      const parts = cleanName.split(' - ');
      const artist = parts[0].trim();
      const title = parts.slice(1).join(' - ').trim();
      return {
        title: title || cleanName,
        artist: artist || 'Unknown',
        album: 'Unknown Album',
        year: '',
        lyrics: '',
        coverUrl: null,
        coverBlob: null,
        duration: 0
      };
    }

    return {
      title: cleanName,
      artist: 'Unknown',
      album: 'Unknown Album',
      year: '',
      lyrics: '',
      coverUrl: null,
      coverBlob: null,
      duration: 0
    };
  }
};

window.ID3Parser = ID3Parser;
