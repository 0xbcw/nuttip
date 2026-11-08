import { QRCodeSVG } from 'qrcode.react';

interface TokenQRProps {
  /** Full cashu: token string, or a plain URL (tip link) to encode. */
  value: string;
  size?: number;
}

/** QR code for a Cashu token or a tip link. Scan it with any Cashu wallet. */
export default function TokenQR({ value, size = 220 }: TokenQRProps) {
  return (
    <div className="token-qr">
      <QRCodeSVG value={value} size={size} level="M" />
      <p className="token-qr-hint">
        Scan with any Cashu wallet to claim the tip.
      </p>
    </div>
  );
}
