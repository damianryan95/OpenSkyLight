import { useState } from 'react'
import { useBalances, usePeople, useRewardMutations, useRewards } from '../../api/hooks'
import { useToasts } from '../../stores/toastStore'
import { Dialog } from '../../components/ui'
import { initials, textOn } from '../../lib/format'
import { isDisplayClient } from '../../lib/clientMode'
import { useUi } from '../../stores/uiStore'
import { peopleInViewingContext } from '@shared/viewingContext'

export function RewardsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: people = [] } = usePeople()
  const viewingContext = useUi((s) => s.viewingContext)
  const { data: rewards = [] } = useRewards()
  const { data: balances = [] } = useBalances()
  const mutations = useRewardMutations()
  const display = isDisplayClient()
  const pushToast = useToasts((s) => s.push)
  const contextPeople = peopleInViewingContext(viewingContext, people)
  const kids = contextPeople.filter((p) => p.role === 'child')
  const candidates = kids.length > 0 ? kids : contextPeople
  const [personId, setPersonId] = useState<string | null>(null)
  const selected = candidates.find((p) => p.id === personId) ?? candidates[0]
  const balance = balances.find((b) => b.personId === selected?.id)?.balance ?? 0

  return (
    <Dialog open={open} onClose={onClose} title="Rewards">
      {candidates.length === 0 || rewards.length === 0 ? (
        <p className="text-base font-semibold text-ink-soft">
          {candidates.length === 0
            ? 'Add family members first, then set up rewards in Settings → Chores.'
            : 'No rewards yet — parents can add them in Settings → Chores.'}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {candidates.map((p) => {
              const on = p.id === selected?.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPersonId(p.id)}
                  className={`pressable flex items-center gap-2 rounded-full py-1 pr-3.5 pl-1 text-base font-bold ${
                    on ? 'shadow-card' : 'bg-paper-deep text-ink-soft'
                  }`}
                  style={on ? { backgroundColor: p.color, color: textOn(p.color) } : undefined}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold"
                    style={{
                      backgroundColor: on ? 'rgba(255,255,255,0.28)' : p.color,
                      color: on ? 'inherit' : textOn(p.color)
                    }}
                  >
                    {initials(p.name)}
                  </span>
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className="text-center font-display text-2xl">
            {selected?.name} has <span className="text-ember-deep">★ {balance}</span>
          </div>
          <div className="flex flex-col gap-2">
            {rewards.map((r) => {
              const affordable = balance >= r.costStars
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-3">
                  <span className="min-w-0 flex-1 truncate text-lg font-bold">{r.title}</span>
                  <span className="text-base font-extrabold text-ember-deep">★ {r.costStars}</span>
                  {display ? (
                    <span className="rounded-full bg-paper px-4 py-2 text-sm font-bold text-ink-faint">Parent only</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!affordable || !selected}
                      onClick={() =>
                        mutations.redeem.mutate(
                          { rewardId: r.id, personId: selected!.id },
                          { onSuccess: () => pushToast(`${r.title} requested — ask a parent to approve it!`) }
                        )
                      }
                      className="pressable rounded-full bg-ember px-4 py-2 text-sm font-bold text-white disabled:opacity-30"
                    >
                      Redeem
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Dialog>
  )
}
