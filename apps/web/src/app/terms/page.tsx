import Link from 'next/link';
export default function Terms() {
  return (
    <div className='content-page'>
      <span className='eyebrow'>ABOUT THIS CLIENT</span>
      <h1>Open source. Open participation.</h1>
      <p>
        poidh Ultra is an independent, open-source interface to the existing
        poidh protocol, maintained by Arca Computer contributors.
      </p>
      <h2>Using the protocol</h2>
      <p>
        Bounty deposits, contributions, votes, refunds, and withdrawals are
        governed by the deployed smart contracts. Review each transaction in
        your wallet. The interface cannot reverse confirmed blockchain
        transactions.
      </p>
      <h2>Your proof and community content</h2>
      <p>
        Upload content you have the right to publish. Proof files and NFT
        metadata use immutable public URLs; blockchain references persist.
        Community comments and profile information can be edited or deleted by
        their authors and moderated by the service’s moderators.
      </p>
      <h2>Your session</h2>
      <p>
        A wallet signature signs you in to this site. Sessions are bound to this
        domain, stored in a secure browser cookie, and expire after seven days.
        Ultra does not receive your wallet’s private keys.
      </p>
      <h2>The software</h2>
      <p>
        The code is distributed under its MIT license and retained upstream
        notices. Hosting and protocol access remain separate from software
        licensing.
      </p>
      <Link
        className='text-link'
        href='https://github.com/arcacomputer/poidhultra'
      >
        Read the source and license ↗
      </Link>
    </div>
  );
}
