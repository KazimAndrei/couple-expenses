/**
 * @typedef {Object} Couple
 * @property {string} id
 * @property {string} name
 * @property {string} currency
 * @property {string} invite_code
 * @property {string} created_at
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string|null} couple_id
 * @property {string} display_name
 * @property {string|null} avatar_url
 * @property {string} created_at
 * @property {Couple|null} [couples]
 */

/**
 * @typedef {Object} Expense
 * @property {string} id
 * @property {string} couple_id
 * @property {string|null} category_id
 * @property {string} paid_by
 * @property {number} amount
 * @property {string} currency
 * @property {string} description
 * @property {'equal'|'custom'|'full_payer'|'full_other'} split
 * @property {number} split_payer_pct
 * @property {string} expense_date
 * @property {string} created_at
 * @property {string} updated_at
 * @property {{name:string, icon:string, color:string}|null} [categories]
 * @property {{display_name:string}|null} [profiles]
 */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} couple_id
 * @property {string} name
 * @property {string} icon
 * @property {string} color
 * @property {number} sort_order
 */

/**
 * @typedef {Object} Goal
 * @property {string} id
 * @property {string} couple_id
 * @property {string} name
 * @property {number} target_amount
 * @property {number} current_amount
 * @property {string} icon
 * @property {string|null} deadline
 * @property {boolean} completed
 */

/**
 * @typedef {Object} Budget
 * @property {string} id
 * @property {string} couple_id
 * @property {string} category_id
 * @property {string} month
 * @property {number} limit_amount
 * @property {{name:string, icon:string, color:string}|null} [categories]
 */

/**
 * @typedef {Object} Member
 * @property {string} id
 * @property {string} display_name
 * @property {string|null} avatar_url
 */

/**
 * @typedef {Object} AppState
 * @property {Object|null} user
 * @property {Profile|null} profile
 * @property {Couple|null} couple
 * @property {Category[]} categories
 * @property {Expense[]} expenses
 * @property {Budget[]} budgets
 * @property {Goal[]} goals
 * @property {Member[]} members
 * @property {string|null} filterBy
 * @property {string|null} analyticsFilterBy
 * @property {string|null} currentMonth
 * @property {boolean} loading
 */
