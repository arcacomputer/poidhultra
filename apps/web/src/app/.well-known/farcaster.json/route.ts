export function GET() {
  return Response.json(
    { error: 'Miniapp integration is not configured for this domain' },
    { status: 404 }
  );
}
