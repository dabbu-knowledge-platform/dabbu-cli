/* Dabbu CLI - A CLI that leverages the Dabbu API and neatly retrieves your files and folders scattered online
 *
 * Copyright (C) 2021  gamemaker1
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const chalk = require('chalk')
const axios = require('axios')
const prompt = require('readcommand')

const Client = require('./client.js').Client
const client = new Client()

const Klient = require('./knowledge.js').Klient
const klient = new Klient()

const {
	get,
	set,
	getDrawableText,
	handleInputError,
	deleteConfig,
	exitDabbu,
	printInfo,
	printBright,
	printError,
	highlight
} = require('./utils.js')

// Main function
function main() {
	// Draw fancy text
	getDrawableText('Dabbu') // Get the text
		.then(printBright) // Print it out
		.then(checkSetupAndRun) // Check if the user is new and act accordingly
		.catch(printError) // Any error should be printed out
}

// Check if the user is new and act accordingly
function checkSetupAndRun() {
	// If the user hasn't been setup, create a new drive
	if (get('setup-done')) {
		// First check if the current drive is valid, as someone may have
		// deleted a provider and not changed the current drive
		const currentDriveName = get('current-drive')
		const currentDriveVars = get(`drives.${currentDriveName}`) || {}
		// Check if there is no current drive
		if (
			!currentDriveName ||
			JSON.stringify(currentDriveVars) === '{}' ||
			!currentDriveVars.provider
		) {
			// If not, then get all the current drives possible
			const allDrives = Object.keys(get('drives'))
			if (allDrives.length === 0) {
				// If there are no current drives, delete the config and exit, let them start again
				// We delete the config because they have messed with the only drive they had, so
				// there is no config other than server address that we will be deleting
				printError(
					`No valid drive was found. Deleting config and exiting. Running again will start setup.`
				)
				deleteConfig()
				exitDabbu()
			} else {
				// Else, if there are a few drives left, change to the first one that's not empty
				for (let i = 0, length = allDrives.length; i < length; i++) {
					const driveName = allDrives[i]
					const driveVars = get(`drives.${driveName}`)
					// Make sure it is not the current drive and has at least the provider field
					if (driveName !== currentDriveName && driveVars.provider) {
						set('current-drive', driveName)
						printError(
							`Current drive was not set to a valid drive or current drive configuration was corrupt. Changing to ${driveName}:`
						)
						break
					} else {
						// Empty that drive so it never gets picked, it is not properly configured
						set(`drives.${driveName}`, {})
					}
				}
			}
		}

		// Then print help
		help()
		// Then show them the command line
		showPrompt()
	} else {
		createNewDrive()
	}
}

// Create a new drive
function createNewDrive() {
	// Ask the user for the address of the server
	const requestServerAddress = () => {
		// Wrap everything in a promise
		return new Promise((resolve, reject) => {
			// Get it only if there is no existing server
			if (get('server')) {
				// Else return the current server
				resolve(get('server'))
			} else {
				// Ask them to enter it
				prompt.read(
					{
						ps1: `Enter your server's address ${chalk.gray(
							'default: https://dabbu-server.herokuapp.com'
						)} > `
					},
					(error, args) => {
						// If there is an error, handle it
						if (error) {
							reject(error)
						} else {
							// If there is no error, get the address
							const server = args[0] || 'https://dabbu-server.herokuapp.com'
							// Store it in config
							set('server', server)
							// Return successfully
							resolve(server)
						}
					}
				)
			}
		})
	}

	// Get all enabled providers from the server
	const getProviders = (server) => {
		// Wrap everything in a promise
		return new Promise((resolve, reject) => {
			// The URL to send the request to
			const url = `${server}/files-api/v2/providers`
			// Send a GET request
			axios
				.get(url)
				.then((result) => {
					if (result.data.content.providers.length > 0) {
						// If there are some providers, return them
						resolve([...result.data.content.providers, 'knowledge'])
					} else {
						// Else error out
						reject(
							new Error(
								'An unexpected error occurred: The server returned no valid/enabled providers'
							)
						)
					}
				})
				.catch(reject) // Pass error back if any
		})
	}

	// Ask the user to choose a provider
	const requestProvider = (providers) => {
		// Wrap everything in a promise
		return new Promise((resolve, reject) => {
			// Join the providers into a presentable list
			const providerString = providers.join(', ')

			// Tell the user about the base path they need to enter
			printInfo(`Choose a provider to setup first - ${providerString}`)

			// Ask them to enter it
			prompt.read(
				{
					ps1: `Enter the provider name as is > `
				},
				(error, args) => {
					// If there is an error, handle it
					if (error) {
						reject(error)
					} else {
						// If there is no error, get the provider
						let provider = args.join('_')
						// Check that they have entered a valid provider
						if (
							provider &&
							providers.includes(provider.replace(/ /g, '_').toLowerCase())
						) {
							provider = provider.replace(/ /g, '_').toLowerCase()
							// Return successfully
							resolve(provider)
						} else {
							// If they haven't entered anything, flag it and ask again
							printError(`Choose a provider to setup first - ${providerString}`)
							resolve(requestProvider(providers))
						}
					}
				}
			)
		})
	}

	// Ask the user for a name for the drive
	const requestDriveName = (provider) => {
		// Wrap everything in a promise
		return new Promise((resolve, reject) => {
			// Ask them to enter it
			prompt.read(
				{
					ps1: `Enter a name for your drive > `
				},
				(error, args) => {
					// If there is an error, handle it
					if (error) {
						reject(error)
					} else {
						// If there is no error, get the name
						let name = args.join('_')
						// Check that they have entered something non null
						if (name) {
							// Else create a drive in config by setting the provider and path
							name = name.replace(/ /g, '_').replace(/:/g, '')
							set(`drives.${name}.provider`, provider)
							set(`drives.${name}.path`, '')
							// Return successfully
							resolve([name, provider])
						} else {
							// If they haven't entered anything, flag it and ask again
							printError('Please enter a name for the drive. (e.g.: c, d, e)')
							resolve(requestDriveName(provider))
						}
					}
				}
			)
		})
	}

	// Let the provider do the rest
	const providerInit = ([name, provider]) => {
		// Wrap everything in a promise
		return new Promise((resolve, reject) => {
			if (provider === 'knowledge') {
				klient
					.init(name)
					.then(() => printBright(`\nCreated ${name}:\n`))
					.then(() => help())
					.then(() => resolve(name))
					.catch(reject)
			} else {
				client
					.init(name)
					.then(() => printBright(`\nCreated ${name}:\n`))
					.then(() => help())
					.then(() => resolve(name))
					.catch(reject)
			}
		})
	}

	return requestServerAddress() // Get the server address from the user
		.then(getProviders) // Then get enabled providers from the server
		.then(requestProvider) // Then ask the user to choose a provider to setup
		.then(requestDriveName) // Get the name of the drive to create from the user
		.then(providerInit) // Let the provider run the rest
		.then((name) => set('current-drive', name)) // Set the current drive
		.then(() => set('setup-done', true)) // Mark the setup as done
		.then(() => showPrompt()) // Show the user the command line
		.catch(printError) // Print the error, if any
}

// Switch to another drive
function switchDrive(args) {
	// Wrap everything in a promise
	return new Promise((resolve, reject) => {
		// Get the drive the user wants to switch to
		const drive = args[0].replace(/:/g, '')
		// Get the drives the user has setup
		const drives = get('drives')

		// If there is a drive with that name, switch to it
		if (drives[drive]) {
			set('current-drive', drive)
			resolve()
		} else {
			// Else error out
			reject(
				new Error(
					`Invalid drive name - choose one of these - ${Object.keys(
						drives
					).join(', ')}`
				)
			)
		}
	})
}

// Print out the help message
function help() {
	return printInfo(
		[
			`${highlight(`Dabbu CLI v${require('../package.json').version}`)}`,
			'',
			'Usage: command [options]',
			'  - Anything in <> must be mentioned, while if it is in [], it is optional.',
			'  - All file/folder paths may include drive names.',
			'  - While specifying a folder, please add a / at the end of the folder name.',
			'  - Escape spaces in the file name by surrounding it in quotes.',
			'',
			`  ${highlight('pwd')} - Know your current drive and directory`,
			`  ${highlight(
				'cd <relative path to directory>'
			)} - Move into a directory`,
			`  ${highlight(
				'ls [relative path to directory]'
			)} - List files in a directory`,
			`  ${highlight(
				'cat <relative path to file>'
			)} - Download and open a file`,
			`  ${highlight(
				'cp <relative path to file> <relative path to place to copy to>'
			)} - Copy a file from one place to another`,
			`  ${highlight(
				'mv <relative path to file> <relative path to place to copy to>'
			)} - Move a file from one place to another`,
			`  ${highlight('rm <relative path to file>')} - Delete a file`,
			`  ${highlight(
				'sync <relative path to folder> <relative path to folder to sync files to>'
			)} - Sync files from one folder to another efficiently`,
			`  ${highlight(
				'<drive name>:'
			)} - Switch drives (Notice the colon at the end of the drive name)`,
			`  ${highlight('::')} - Create a new drive`,
			`  ${highlight('clear')} - Clear the screen`,
			`  ${highlight('CTRL+C')} - Exit`,
			''
		].join('\n')
	)
}

// Show the user a prompt to enter input
function showPrompt(error = null) {
	// If there is an error, show it and then continue with the prompt
	if (error) printError(error)

	prompt.read(
		{
			ps1: getPromptPs(), // The PS is the prefix to the user's input
			history: getPromptHistory() // Past commands can be accessed with the up key
		},
		(error, args) => {
			// Add the command to history
			const command = args
				.map((arg) => {
					if (arg.includes(' ')) {
						return `"${arg}"`
					}

					return arg
				})
				.join(' ')
			if (command !== '') {
				// Get current history
				let history = get('history') || []
				// Trim the length to the last 20 commands
				history =
					history.length > 19
						? [...history.slice(-18, -1), command]
						: [...history, command]

				// Set it in config
				set('history', history)
			}

			// If there is an error, handle it
			if (error) {
				handleInputError(error) // Handle the error
				return showPrompt() // Show prompt again
			}

			// If there is no error, parse the input
			// Check if there is some input
			if (args.length === 0) {
				// If not, return an error
				return showPrompt(new Error('Invalid command'))
			}

			// First check if the command ends with a colon
			if (args[0].endsWith(':')) {
				// If it is, we are either changing drives or creating a new one
				if (args[0] === '::') {
					return createNewDrive().then(showPrompt).catch(showPrompt)
				}

				return switchDrive(args).then(showPrompt).catch(showPrompt)
			}

			// Check if the command is `clear`
			if (args[0] === 'clear') {
				// If so, clear the screen
				process.stdout.write('\u001B[2J')
				process.stdout.write('\u001B[0f')
				return showPrompt()
			}

			// Check if the command is `help`
			if (args[0] === 'help') {
				// If so, print help
				help()
				return showPrompt()
			}

			// Check if we are in the knowledge drive
			if (get(`drives.${get('current-drive')}.provider`) === 'knowledge') {
				// If so, execute the function according to the knowledge drive
				// Check if there is a function for that command
				if (typeof klient.ops[args[0]] !== 'function') {
					return showPrompt(new Error('Invalid command'))
				}

				// If there is, run it
				return klient.ops[args[0]](args)
					.then(showPrompt) // Then show prompt again
					.catch(showPrompt) // Show prompt again, but pass the error to it
			}

			// Else execute the function normally
			// Check if there is a function for that command
			if (typeof client.ops[args[0]] !== 'function') {
				return showPrompt(new Error('Invalid command'))
			}

			// If there is, run it
			return client.ops[args[0]](args)
				.then(showPrompt) // Then show prompt again
				.catch(showPrompt) // Show prompt again, but pass the error to it
		}
	)
}

function getPromptPs() {
	// Current drive
	const drive = get('current-drive')
	const driveVars = get(`drives.${drive}`) || {}
	// Return the drive and the current path as the PS
	return chalk.cyan(`${drive}:${driveVars.path || ''}$ `)
}

function getPromptHistory() {
	return get('history') || []
}

// Start the app
main()
