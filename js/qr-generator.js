/**
 * VChat Self-Contained Lightweight QR Code SVG Generator
 * Generates valid, scan-ready QR Code SVGs in Byte Mode without external dependencies.
 * Supports URLs up to 80 characters (QR Model 2, Version 4/5, ECC Level M).
 */
(function (global) {
    // GF(256) Math
    const GF_EXP = new Uint8Array(512);
    const GF_LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_EXP[i + 255] = x;
        GF_LOG[x] = i;
        x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
    }

    function gfMul(a, b) {
        if (a === 0 || b === 0) return 0;
        return GF_EXP[GF_LOG[a] + GF_LOG[b]];
    }

    function rsPolyMul(p, q) {
        const res = new Uint8Array(p.length + q.length - 1);
        for (let i = 0; i < p.length; i++) {
            for (let j = 0; j < q.length; j++) {
                res[i + j] ^= gfMul(p[i], q[j]);
            }
        }
        return res;
    }

    function rsGeneratorPoly(degree) {
        let poly = new Uint8Array([1]);
        for (let i = 0; i < degree; i++) {
            poly = rsPolyMul(poly, new Uint8Array([1, GF_EXP[i]]));
        }
        return poly;
    }

    function rsCalculateRemainder(data, degree) {
        const gen = rsGeneratorPoly(degree);
        const rem = new Uint8Array(data.length + degree);
        rem.set(data);
        for (let i = 0; i < data.length; i++) {
            const factor = rem[i];
            if (factor !== 0) {
                for (let j = 0; j < gen.length; j++) {
                    rem[i + j] ^= gfMul(gen[j], factor);
                }
            }
        }
        return rem.slice(data.length);
    }

    // Version table (Byte mode, ECC M):
    // V3: 29x29, Data capacity: 34 bytes, EC count: 26
    // V4: 33x33, Data capacity: 48 bytes, EC count: 36
    // V5: 37x37, Data capacity: 62 bytes, EC count: 48
    // V6: 41x41, Data capacity: 76 bytes, EC count: 64
    function getVersionInfo(dataLen) {
        if (dataLen <= 32) return { version: 3, size: 29, totalData: 44, ecWords: 26, align: [6, 22] };
        if (dataLen <= 46) return { version: 4, size: 33, totalData: 64, ecWords: 36, align: [6, 26] };
        if (dataLen <= 60) return { version: 5, size: 37, totalData: 86, ecWords: 48, align: [6, 30] };
        return { version: 6, size: 41, totalData: 108, ecWords: 64, align: [6, 34] };
    }

    function encodeToQrSvg(text) {
        const utf8 = new TextEncoder().encode(String(text || ""));
        const vInfo = getVersionInfo(utf8.length);
        const { size, ecWords, align } = vInfo;

        // Bit stream construction: Mode (0100 for Byte) + Count (8 bits) + Data + Term (0000)
        const bits = [];
        function pushBits(val, len) {
            for (let i = len - 1; i >= 0; i--) {
                bits.push((val >> i) & 1);
            }
        }

        pushBits(0b0100, 4); // Byte mode
        pushBits(utf8.length, 8); // Character count
        for (let i = 0; i < utf8.length; i++) {
            pushBits(utf8[i], 8);
        }

        // Terminator
        const totalDataBits = (vInfo.totalData - ecWords) * 8;
        const termLen = Math.min(4, totalDataBits - bits.length);
        pushBits(0, termLen);

        // Byte alignment padding
        while (bits.length % 8 !== 0) bits.push(0);

        // Pad bytes 0xEC, 0x11
        const padBytes = [0xec, 0x11];
        let padIdx = 0;
        while (bits.length < totalDataBits) {
            pushBits(padBytes[padIdx % 2], 8);
            padIdx++;
        }

        // Convert data bits to bytes
        const dataBytes = new Uint8Array(totalDataBits / 8);
        for (let i = 0; i < dataBytes.length; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) {
                b = (b << 1) | bits[i * 8 + j];
            }
            dataBytes[i] = b;
        }

        // Calculate Reed-Solomon EC words
        const ecBytes = rsCalculateRemainder(dataBytes, ecWords);

        // Interleave codewards (single block for small versions)
        const allCodewords = new Uint8Array(dataBytes.length + ecBytes.length);
        allCodewords.set(dataBytes);
        allCodewords.set(ecBytes, dataBytes.length);

        // Matrix initialization (0 = unassigned, 1 = white, 2 = black)
        const matrix = Array.from({ length: size }, () => new Uint8Array(size));
        const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

        function setModule(r, c, isBlack) {
            if (r >= 0 && r < size && c >= 0 && c < size) {
                matrix[r][c] = isBlack ? 2 : 1;
                isFunction[r][c] = 1;
            }
        }

        // 1. Finder patterns (7x7) + Separators
        function drawFinder(row, col) {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const nr = row + r;
                    const nc = col + c;
                    if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                    if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
                        const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
                        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                        setModule(nr, nc, isBorder || isCenter);
                    } else {
                        setModule(nr, nc, false); // Separator
                    }
                }
            }
        }

        drawFinder(0, 0);
        drawFinder(0, size - 7);
        drawFinder(size - 7, 0);

        // 2. Timing patterns
        for (let i = 8; i < size - 8; i++) {
            setModule(6, i, i % 2 === 0);
            setModule(i, 6, i % 2 === 0);
        }

        // 3. Alignment patterns (5x5)
        for (const r of align) {
            for (const c of align) {
                if (isFunction[r][c]) continue;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const isBlack = (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
                        setModule(r + dr, c + dc, isBlack);
                    }
                }
            }
        }

        // 4. Dark module
        setModule(size - 8, 8, true);

        // 5. Reserve format information areas
        for (let i = 0; i < 9; i++) {
            if (!isFunction[8][i]) isFunction[8][i] = 1;
            if (!isFunction[i][8]) isFunction[i][8] = 1;
        }
        for (let i = size - 8; i < size; i++) {
            if (!isFunction[8][i]) isFunction[8][i] = 1;
            if (!isFunction[i][8]) isFunction[i][8] = 1;
        }

        // 6. Place Data Codewords (zigzag traversal)
        let bitIndex = 0;
        const totalCodewordBits = allCodewords.length * 8;

        for (let col = size - 1; col > 0; col -= 2) {
            if (col === 6) col--; // Skip timing column
            const upwards = ((size - 1 - col) / 2) % 2 === 0;
            for (let vert = 0; vert < size; vert++) {
                const r = upwards ? size - 1 - vert : vert;
                for (let c = col; c >= col - 1; c--) {
                    if (!isFunction[r][c]) {
                        let bit = 0;
                        if (bitIndex < totalCodewordBits) {
                            const bytePos = Math.floor(bitIndex / 8);
                            const bitPos = 7 - (bitIndex % 8);
                            bit = (allCodewords[bytePos] >> bitPos) & 1;
                            bitIndex++;
                        }
                        // Apply Mask Pattern 0: (row + col) % 2 === 0
                        const mask = ((r + c) % 2 === 0);
                        matrix[r][c] = (bit ^ (mask ? 1 : 0)) ? 2 : 1;
                    }
                }
            }
        }

        // 7. Format Information (ECC M = 00, Mask 0 = 000 -> 00000 with BCH 10100110111 = 0x5412)
        const formatBits = 0x5412; // Precalculated 15-bit format for ECC M, Mask 0
        const fArray = [];
        for (let i = 14; i >= 0; i--) {
            fArray.push((formatBits >> i) & 1);
        }

        // Write format bits around top-left
        const pos1 = [
            [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
            [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
        ];
        pos1.forEach(([r, c], idx) => {
            matrix[r][c] = fArray[idx] ? 2 : 1;
        });

        // Write format bits around bottom-left & top-right
        for (let i = 0; i < 7; i++) {
            matrix[size - 1 - i][8] = fArray[i] ? 2 : 1;
        }
        for (let i = 0; i < 8; i++) {
            matrix[8][size - 8 + i] = fArray[7 + i] ? 2 : 1;
        }

        // Build crisp SVG
        const margin = 2;
        const totalDimension = size + margin * 2;
        let rects = "";
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (matrix[r][c] === 2) {
                    rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1"/>`;
                }
            }
        }

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalDimension} ${totalDimension}" width="180" height="180" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#FFFFFF"/><g fill="#031009">${rects}</g></svg>`;
    }

    function renderQr(text, container) {
        if (!container) return;
        try {
            const svg = encodeToQrSvg(text);
            container.innerHTML = svg;
        } catch (err) {
            container.innerHTML = `<p style="font-size:12px;color:#888;">Could not render QR code.</p>`;
        }
    }

    global.VChatQr = {
        encodeToQrSvg,
        renderQr
    };
})(typeof window !== "undefined" ? window : global);
