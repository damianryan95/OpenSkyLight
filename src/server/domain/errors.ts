export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainValidationError'
  }
}

export class DuplicatePersonNameError extends DomainValidationError {
  constructor(name: string) {
    super(`A child named "${name}" already exists. Child names must be unique for calendar audience matching.`)
    this.name = 'DuplicatePersonNameError'
  }
}

export class HouseholdTimezoneRequiredError extends DomainValidationError {
  constructor() {
    super('Household timezone must be configured before the server can use household dates.')
    this.name = 'HouseholdTimezoneRequiredError'
  }
}
