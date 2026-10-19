//! Text encoding detection and (de)coding for the editable `RopeBuffer`.
//!
//! The editor works in UTF-8 internally (ropey is UTF-8). On open we detect the
//! file's encoding so non-UTF-8 files (many logs) open instead of hard-failing, and
//! we remember it so save round-trips the original encoding rather than silently
//! rewriting it. The large read-only mmap engine has its own encoding path (ADR-0003).

/// The encodings tuhi opens and saves. `Latin1` (ISO-8859-1) is the catch-all for
/// bytes that are not valid UTF-8: every byte maps 1:1 to U+0000..=U+00FF, so it
/// round-trips exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Latin1,
}

/// A decoded document plus how to re-encode it on save.
pub struct Decoded {
    pub text: String,
    pub encoding: Encoding,
    /// Whether the original carried a byte-order mark (preserved on save).
    pub bom: bool,
}

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: [u8; 2] = [0xFF, 0xFE];
const UTF16BE_BOM: [u8; 2] = [0xFE, 0xFF];

/// Detect the encoding and decode to a Rust `String`. Never fails: unknown bytes
/// fall back to Latin-1, and malformed UTF-16 units become U+FFFD.
pub fn decode(bytes: &[u8]) -> Decoded {
    if bytes.starts_with(&UTF8_BOM) {
        return Decoded {
            text: String::from_utf8_lossy(&bytes[3..]).into_owned(),
            encoding: Encoding::Utf8,
            bom: true,
        };
    }
    if bytes.starts_with(&UTF16LE_BOM) {
        return Decoded {
            text: decode_utf16(&bytes[2..], false),
            encoding: Encoding::Utf16Le,
            bom: true,
        };
    }
    if bytes.starts_with(&UTF16BE_BOM) {
        return Decoded {
            text: decode_utf16(&bytes[2..], true),
            encoding: Encoding::Utf16Be,
            bom: true,
        };
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => Decoded {
            text: s.to_owned(),
            encoding: Encoding::Utf8,
            bom: false,
        },
        Err(_) => Decoded {
            text: bytes.iter().map(|&b| b as char).collect(),
            encoding: Encoding::Latin1,
            bom: false,
        },
    }
}

/// Encode a document for saving, re-applying the original BOM where relevant.
/// A char outside Latin-1 that is written back to a Latin-1 file becomes `?`.
pub fn encode(text: &str, encoding: Encoding, bom: bool) -> Vec<u8> {
    match encoding {
        Encoding::Utf8 => {
            let mut out = Vec::with_capacity(text.len() + if bom { 3 } else { 0 });
            if bom {
                out.extend_from_slice(&UTF8_BOM);
            }
            out.extend_from_slice(text.as_bytes());
            out
        }
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let be = encoding == Encoding::Utf16Be;
            let mut out = Vec::with_capacity(text.len() * 2 + 2);
            if bom {
                out.extend_from_slice(if be { &UTF16BE_BOM } else { &UTF16LE_BOM });
            }
            for u in text.encode_utf16() {
                out.extend_from_slice(&if be { u.to_be_bytes() } else { u.to_le_bytes() });
            }
            out
        }
        Encoding::Latin1 => text
            .chars()
            .map(|c| {
                if (c as u32) <= 0xFF {
                    c as u32 as u8
                } else {
                    b'?'
                }
            })
            .collect(),
    }
}

fn decode_utf16(bytes: &[u8], be: bool) -> String {
    let mut units = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0;
    while i + 1 < bytes.len() {
        let pair = [bytes[i], bytes[i + 1]];
        units.push(if be {
            u16::from_be_bytes(pair)
        } else {
            u16::from_le_bytes(pair)
        });
        i += 2;
    }
    char::decode_utf16(units)
        .map(|r| r.unwrap_or('\u{FFFD}'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_plain_round_trips() {
        let d = decode(b"hello\nworld\n");
        assert_eq!(d.encoding, Encoding::Utf8);
        assert!(!d.bom);
        assert_eq!(d.text, "hello\nworld\n");
        assert_eq!(encode(&d.text, d.encoding, d.bom), b"hello\nworld\n");
    }

    #[test]
    fn utf8_bom_is_stripped_and_restored() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("café\n".as_bytes());
        let d = decode(&bytes);
        assert_eq!(d.encoding, Encoding::Utf8);
        assert!(d.bom);
        assert_eq!(d.text, "café\n");
        assert_eq!(encode(&d.text, d.encoding, d.bom), bytes);
    }

    #[test]
    fn utf16le_bom_round_trips() {
        let mut bytes = vec![0xFF, 0xFE];
        for u in "Aé".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        let d = decode(&bytes);
        assert_eq!(d.encoding, Encoding::Utf16Le);
        assert!(d.bom);
        assert_eq!(d.text, "Aé");
        assert_eq!(encode(&d.text, d.encoding, d.bom), bytes);
    }

    #[test]
    fn non_utf8_falls_back_to_latin1_losslessly() {
        // 0xE9 is 'é' in Latin-1 but an invalid lone UTF-8 byte.
        let bytes = vec![b'c', b'a', b'f', 0xE9, b'\n'];
        let d = decode(&bytes);
        assert_eq!(d.encoding, Encoding::Latin1);
        assert!(!d.bom);
        assert_eq!(d.text, "café\n");
        assert_eq!(encode(&d.text, d.encoding, d.bom), bytes); // exact byte round-trip
    }
}
