/**
 * Move-to dialog: pick a group (or ungroupped) for a stock. First-level
 * groups are shown expanded, second-level groups collapsed by default.
 */
import { useState } from 'react'
import type { Group } from './types.js'
import { mutate } from './api.js'
import s from './styles.module.css'

export function MoveDialog({
  code,
  name,
  groups,
  currentGroupId,
  onClose,
  onMoved,
  onError,
}: {
  code: string
  name: string
  groups: Group[]
  currentGroupId?: string
  onClose: () => void
  onMoved: () => void
  onError: (message: string) => void
}): JSX.Element {
  const [target, setTarget] = useState<string | undefined>(currentGroupId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const topLevel = groups.filter((group) => !group.parentId)

  async function apply(): Promise<void> {
    if (moving) return
    setMoving(true)
    try {
      await mutate('groupMove', target ? { code, groupId: target } : { code })
      onMoved()
      onClose()
    } catch (error) {
      setMoving(false)
      onError(String(error))
    }
  }

  function toggle(groupId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(event) => event.stopPropagation()}>
        <div className={s.dialogTitle}>
          移动「{name}」({code})
        </div>
        <div className={s.dialogBody}>
          <div
            className={`${s.moveItem} ${target === undefined ? s.moveItemSelected : ''}`}
            onClick={() => setTarget(undefined)}
          >
            📥 关注（未分组）
          </div>
          <div className={s.moveTree}>
            {topLevel.length === 0 && <div className={s.moveEmpty}>暂无自定义分组</div>}
            {topLevel.map((group) => {
              const children = groups.filter((item) => item.parentId === group.id)
              const isOpen = expanded.has(group.id)
              return (
                <div key={group.id}>
                  <div
                    className={`${s.moveItem} ${target === group.id ? s.moveItemSelected : ''}`}
                    onClick={() => setTarget(group.id)}
                  >
                    {children.length > 0 && (
                      <span className={s.caret} onClick={(event) => { event.stopPropagation(); toggle(group.id) }}>
                        {isOpen ? '▾' : '▸'}
                      </span>
                    )}
                    <span>📁 {group.name}</span>
                  </div>
                  {children.length > 0 && isOpen && (
                    <div className={s.moveChildren}>
                      {children.map((child) => (
                        <div
                          key={child.id}
                          className={`${s.moveItem} ${target === child.id ? s.moveItemSelected : ''}`}
                          onClick={() => setTarget(child.id)}
                        >
                          <span>📂 {child.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className={s.dialogFooter}>
          <button className={s.button} onClick={onClose}>
            取消
          </button>
          <button
            className={`${s.button} ${s.buttonPrimary} ${moving ? s.buttonDisabled : ''}`}
            onClick={() => void apply()}
            disabled={moving}
          >
            移动
          </button>
        </div>
      </div>
    </div>
  )
}
