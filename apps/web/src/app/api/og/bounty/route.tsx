import { ImageResponse } from 'next/og';
export async function GET(request: Request) {
  const url = new URL(request.url);
  return new ImageResponse(
    (
      <div
        style={{
          background: '#2059ee',
          color: '#e9fcae',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 60,
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 30 }}>poidh ULTRA</div>
        <div style={{ fontSize: 64 }}>Pics or it didn’t happen.</div>
        <div style={{ fontSize: 24, marginTop: 30 }}>
          {(
            url.searchParams.get('title') ?? 'Make it happen. Show the proof.'
          ).slice(0, 100)}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
