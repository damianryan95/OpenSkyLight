import type { ReactNode } from 'react'
import { displayCredential } from '../../api/browser'
import { isDisplayClient } from '../../lib/clientMode'
import { EnrolmentScreen } from './EnrolmentScreen'

/**
 * A browser display with no credential has no board to show and, until ADR
 * 0006, no way to get one without a keyboard on the wall. It shows the
 * enrolment ceremony instead of a shell full of unauthorised requests.
 *
 * The Electron host (`window.osl`) is not a registered display and keeps its
 * own path.
 */
export function EnrolmentGate({ children }: { children: ReactNode }) {
  if (isDisplayClient() && displayCredential() === null) return <EnrolmentScreen />
  return <>{children}</>
}
