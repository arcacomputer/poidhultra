'use client';
import { useState, useEffect } from 'react';
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useSwitchChain,
  useReadContract,
} from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import {
  parseEther,
  decodeEventLog,
  type TransactionReceipt,
  type Abi,
} from 'viem';
import {
  abi,
  deployments,
  displayId,
  amountLabel,
  type Deployment,
} from '@poidh/protocol';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { ErrorNotice, WalletButton } from './shell';
import { requireWritableClient } from '@/utils/preview';
export function useTransaction(deployment: Deployment) {
  const account = useAccount();
  const client = usePublicClient({
    chainId: deployment.chainId as 1 | 8453 | 42161,
  });
  const writer = useWriteContract();
  const switcher = useSwitchChain();
  const cache = useQueryClient();
  const [state, setState] = useState<{
    phase: string;
    hash?: string;
    error?: Error;
  }>({ phase: 'idle' });
  async function send(
    functionName: string,
    args: readonly unknown[] = [],
    value?: bigint
  ): Promise<TransactionReceipt | undefined> {
    try {
      requireWritableClient();
      if (deployment.archive)
        throw new Error('This deployment is a historical archive.');
      if (!account.address) throw new Error('Connect your wallet first.');
      if (!client) throw new Error('Network unavailable.');
      setState({ phase: 'Checking transaction…' });
      if (account.chainId !== deployment.chainId)
        await switcher.switchChainAsync({
          chainId: deployment.chainId as 1 | 8453 | 42161,
        });
      const code = await client.getBytecode({ address: deployment.address });
      if (!code || code === '0x')
        throw new Error('No contract at the configured deployment.');
      const simulation = await client.simulateContract({
        address: deployment.address,
        abi: abi as Abi,
        functionName,
        args,
        account: account.address,
        ...(value !== undefined ? { value } : {}),
      });
      setState({ phase: 'Confirm in your wallet…' });
      const hash = await writer.writeContractAsync({
        ...simulation.request,
        chainId: deployment.chainId as 1 | 8453 | 42161,
      } as any);
      setState({ phase: 'Waiting for confirmation…', hash });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== 'success')
        throw new Error('Transaction reverted.');
      setState({ phase: 'Confirmed', hash });
      await cache.invalidateQueries();
      return receipt;
    } catch (error) {
      setState((prev) => ({
        phase: 'failed',
        hash: prev.hash,
        error: new Error(
          (error as any).shortMessage ?? (error as Error).message
        ),
      }));
    }
  }
  return {
    send,
    state,
    busy: !['idle', 'Confirmed', 'failed'].includes(state.phase),
  };
}
export function TransactionStatus({
  transaction,
  chainId,
}: {
  transaction: ReturnType<typeof useTransaction>;
  chainId: number;
}) {
  const { state } = transaction;
  const explorer =
    chainId === 1
      ? 'etherscan.io'
      : chainId === 8453
      ? 'basescan.org'
      : 'arbiscan.io';
  return state.phase === 'idle' ? null : (
    <div
      className={'transaction-status ' + (state.error ? 'error' : '')}
      role='status'
    >
      {state.error?.message ?? state.phase}
      {state.hash && (
        <a
          target='_blank'
          rel='noreferrer'
          href={`https://${explorer}/tx/${state.hash}`}
        >
          View transaction ↗
        </a>
      )}
      {state.phase === 'Confirmed' && (
        <small> The indexer will catch up shortly.</small>
      )}
    </div>
  );
}
export function NativeAmount({
  label,
  value,
  onChange,
  minimum,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minimum?: bigint;
}) {
  return (
    <label className='field'>
      {label}
      <input
        inputMode='decimal'
        pattern='[0-9]+([.][0-9]{1,18})?'
        placeholder='0.01'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <small>
        ETH
        {minimum !== undefined
          ? ' · Minimum ' + amountLabel(minimum.toString(), 18) + ' ETH'
          : ''}
      </small>
    </label>
  );
}
export function parseAmount(value: string) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value))
    throw new Error('Enter an ETH amount with up to 18 decimal places.');
  const amount = parseEther(value);
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  return amount;
}
export function CreateBounty() {
  const [network, setNetwork] = useState('8453');
  const d = deployments.find((d) => d.chainId === Number(network))!;
  const tx = useTransaction(d);
  const router = useRouter();
  const { address } = useAccount();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [multiplayer, setMultiplayer] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [restored, setRestored] = useState(false);
  const minimum = useReadContract({
    address: d.address,
    abi,
    functionName: 'MIN_BOUNTY_AMOUNT',
    chainId: d.chainId as 1 | 8453 | 42161,
  });
  useEffect(() => {
    try {
      const draft = JSON.parse(
        localStorage.getItem('poidh:bounty-draft') ?? 'null'
      );
      if (draft) {
        setTitle(draft.title ?? '');
        setDescription(draft.description ?? '');
        setAmount(draft.amount ?? '');
      }
    } catch {}
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored)
      localStorage.setItem(
        'poidh:bounty-draft',
        JSON.stringify({ title, description, amount })
      );
  }, [title, description, amount, restored]);
  return (
    <div className='content-page'>
      <Link href='/' className='breadcrumb'>
        <ArrowLeft size={15} />
        Back to bounties
      </Link>
      <span className='eyebrow'>WHAT DO YOU WANT TO SEE HAPPEN?</span>
      <h1>Start something good.</h1>
      <p className='muted'>
        Set a clear challenge, add a reward, and let the community surprise you.
      </p>
      <form
        className='form-panel stack'
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const value = parseAmount(amount);
            if (minimum.data && value < minimum.data)
              throw new Error('Amount is below the contract minimum.');
            const result = await tx.send(
              multiplayer ? 'createOpenBounty' : 'createSoloBounty',
              [title, description],
              value
            );
            if (result) {
              localStorage.removeItem('poidh:bounty-draft');
              for (const log of result.logs) {
                try {
                  const decoded = decodeEventLog({
                    abi,
                    data: log.data,
                    topics: log.topics,
                  });
                  if (decoded.eventName === 'BountyCreated') {
                    router.push(
                      `/${d.slug}/bounty/${displayId(
                        d.chainId,
                        decoded.args.id.toString()
                      )}`
                    );
                    break;
                  }
                } catch {}
              }
            }
          } catch (e) {
            setError(e as Error);
          }
        }}
      >
        <label className='field'>
          Give your bounty a title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder='e.g. Plant a tree in your neighborhood'
            required
          />
        </label>
        <label className='field'>
          What does success look like?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            placeholder='Describe the challenge, the proof you want to see, and how you’ll choose a winner.'
            required
          />
        </label>
        <div className='form-row'>
          <label className='field'>
            Network
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
            >
              {deployments
                .filter((d) => !d.archive)
                .map((d) => (
                  <option key={d.chainId} value={d.chainId}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
          <NativeAmount
            label='Your reward'
            value={amount}
            onChange={setAmount}
            minimum={minimum.data}
          />
        </div>
        <label className='field'>
          Bounty type
          <select
            value={multiplayer ? 'open' : 'solo'}
            onChange={(e) => setMultiplayer(e.target.value === 'open')}
          >
            <option value='open'>Open — others can contribute</option>
            <option value='solo'>Solo — funded and decided by you</option>
          </select>
          <small>
            {multiplayer
              ? 'Once anyone else contributes, choosing a winner requires a contribution-weighted vote.'
              : 'You choose the winning proof.'}
          </small>
        </label>
        <p className='notice'>
          Your reward is deposited into the existing poidh contract. Winners
          receive a withdrawable balance after acceptance. Contract fees apply
          to accepted claims.
        </p>
        {error && <ErrorNotice error={error} />}
        <TransactionStatus transaction={tx} chainId={d.chainId} />
        {address ? (
          <button
            className='button button-blue'
            disabled={tx.busy || minimum.isPending}
            type='submit'
          >
            <Plus size={17} />
            Create bounty
          </button>
        ) : (
          <WalletButton />
        )}
        <span className='draft-label'>
          Your draft stays in this browser until you publish.
        </span>
      </form>
    </div>
  );
}
export function WithdrawBalance({ deployment }: { deployment: Deployment }) {
  const { address } = useAccount();
  const tx = useTransaction(deployment);
  const [destination, setDestination] = useState('');
  const balance = useReadContract({
    address: deployment.address,
    abi,
    functionName: 'pendingWithdrawals',
    args: [address!],
    chainId: deployment.chainId as 1 | 8453 | 42161,
    query: {
      enabled: !!address && !deployment.archive,
      refetchInterval: 15_000,
    },
  });
  return !balance.data ? null : (
    <div className='notice'>
      <strong>
        {deployment.name}: {amountLabel(balance.data.toString(), 8)} ETH
        available
      </strong>
      <p>Accepted rewards and refunds become a withdrawable balance.</p>
      <label className='field'>
        Recipient (optional)
        <input
          placeholder={address}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          pattern='0x[0-9a-fA-F]{40}'
        />
      </label>
      <button
        className='button button-small'
        disabled={
          tx.busy || (!!destination && !/^0x[0-9a-fA-F]{40}$/.test(destination))
        }
        onClick={() =>
          tx.send(
            destination ? 'withdrawTo' : 'withdraw',
            destination ? [destination] : []
          )
        }
      >
        Withdraw funds
      </button>
      <TransactionStatus transaction={tx} chainId={deployment.chainId} />
    </div>
  );
}
