/**
 * Musico - ID3 & Audio Metadata Parser
 * Extracts Title, Artist, Album, Year, and Embedded Album Art directly from local audio files.
 */

const ID3Parser = {
  /**
   * Parse metadata from an audio File or Blob
   * @param {File|Blob} file 
   * @returns {Promise<Object>} Metadata object
   */
  async parse(file) {
    const fallback = this.getFallbackMetadata(file.name || 'Unknown Track');
    try {
      // 1. Try reading ID3v2 tags (MP3 / WAV with ID3 chunk)
      const headerBuffer = await file.slice(0, 262144).arrayBuffer(); // Read first 256KB
      const id3v2 = this.parseID3v2(headerBuffer);

      if (id3v2 && (id3v2.title || id3v2.artist || id3v2.coverUrl || id3v2.coverBlob)) {
        return {
          title: id3v2.title || fallback.title,
          artist: id3v2.artist || fallback.artist,
          album: id3v2.album || fallback.album,
          year: id3v2.year || '',
          coverUrl: id3v2.coverUrl || null,
          coverBlob: id3v2.coverBlob || null,
          duration: 0
        };
      }

      // 2. Try FLAC / OGG picture & metadata block
      if (file.name.toLowerCase().endsWith('.flac') || file.name.toLowerCase().endsWith('.ogg')) {
        const flacMeta = this.parseFLAC(headerBuffer);
        if (flacMeta) {
          return {
            title: flacMeta.title || fallback.title,
            artist: flacMeta.artist || fallback.artist,
            album: flacMeta.album || fallback.album,
            year: flacMeta.year || '',
            coverUrl: flacMeta.coverUrl || null,
            coverBlob: flacMeta.coverBlob || null,
            duration: 0
          };
        }
      }

      // 3. Try M4A / MP4 atom tags (covr, ©nam, ©ART, ©alb)
      if (file.name.toLowerCase().endsWith('.m4a') || file.name.toLowerCase().endsWith('.aac') || file.name.toLowerCase().endsWith('.mp4')) {
        const m4aMeta = this.parseM4A(headerBuffer);
        if (m4aMeta) {
          return {
            title: m4aMeta.title || fallback.title,
            artist: m4aMeta.artist || fallback.artist,
            album: m4aMeta.album || fallback.album,
            year: m4aMeta.year || '',
            coverUrl: m4aMeta.coverUrl || null,
            coverBlob: m4aMeta.coverBlob || null,
            duration: 0
          };
        }
      }

      // 4. Try ID3v1 at the end of the file (last 128 bytes)
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
            duration: 0
          };
        }
      }

      return fallback;
    } catch (err) {
      console.warn('Metadata parse error, using filename fallback:', err);
      return fallback;
    }
  },

  /**
   * Parse ID3v2 headers and frames (v2.2, v2.3, v2.4)
   */
  parseID3v2(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 10) return null;

    // Check "ID3" identifier
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
      coverUrl: null
    };

    // ID3v2.2 uses 3-byte frame identifiers and 3-byte frame sizes
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
        else if (frameId === 'PIC' && !result.coverUrl) result.coverUrl = this.decodeAPICFrame(frameBuffer);

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
      } else if (frameId === 'APIC' && !result.coverUrl) {
        const apic = this.decodeAPICFrame(frameBuffer);
        if (apic) {
          result.coverUrl = apic.coverUrl;
          result.coverBlob = apic.coverBlob;
        }
      }

      offset += 10 + frameSize;
    }

    return result;
  },

  /**
   * Decode APIC (Attached Picture) frame to Blob URL & Blob
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
        coverBlob: blob,
        coverUrl: URL.createObjectURL(blob)
      };
    } catch (e) {
      console.warn('Error decoding APIC cover image:', e);
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

        if (blockType === 6) { // PICTURE block
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
            coverBlob: blob,
            coverUrl: URL.createObjectURL(blob) 
          };
        }
        offset += blockSize;
      }
    } catch (e) {
      console.warn('FLAC metadata error:', e);
    }
    return null;
  },

  /**
   * Parse M4A / MP4 covr atom
   */
  parseM4A(buffer) {
    try {
      const bytes = new Uint8Array(buffer);
      // Search for 'covr' atom in buffer
      for (let i = 0; i < bytes.length - 8; i++) {
        if (bytes[i] === 0x63 && bytes[i + 1] === 0x6F && bytes[i + 2] === 0x76 && bytes[i + 3] === 0x72) { // "covr"
          // Skip atom header + data atom header (approx 16-24 bytes)
          let dataOffset = i + 4;
          while (dataOffset < bytes.length - 8) {
            if (bytes[dataOffset] === 0x64 && bytes[dataOffset + 1] === 0x61 && bytes[dataOffset + 2] === 0x74 && bytes[dataOffset + 3] === 0x61) { // "data"
              const dataLen = (bytes[dataOffset - 4] << 24) | (bytes[dataOffset - 3] << 16) | (bytes[dataOffset - 2] << 8) | bytes[dataOffset - 1];
              const imgStart = dataOffset + 12; // skip flags & type
              const imgLen = dataLen - 16;
              if (imgStart + imgLen <= bytes.length) {
                const imgBytes = bytes.slice(imgStart, imgStart + imgLen);
                const blob = new Blob([imgBytes], { type: 'image/jpeg' });
                return { 
                  coverBlob: blob,
                  coverUrl: URL.createObjectURL(blob) 
                };
              }
            }
            dataOffset++;
          }
        }
      }
    } catch (e) {
      console.warn('M4A cover parse error:', e);
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
        coverUrl: null,
        duration: 0
      };
    }

    return {
      title: cleanName,
      artist: 'Unknown',
      album: 'Unknown Album',
      year: '',
      coverUrl: null,
      duration: 0
    };
  }
};

window.ID3Parser = ID3Parser;
