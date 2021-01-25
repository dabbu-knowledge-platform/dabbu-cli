// MARK: Imports

const chalk = require("chalk")
const ora = require("ora")
const link = require("terminal-link")
const axios = require("axios")
const fs = require("fs-extra")
const store = require("data-store")({ path: `${__dirname}/../config/dabbu_cli_config.json` })
const http = require("http")
const url = require("url")
const open = require("open")
const FormData = require("form-data")
const { nanoid } = require("nanoid")
const { Input, Confirm } = require("enquirer")
const { waterfall, ask, replaceAll, parsePath, error, exit, getExtFromMime } = require("../utils.js")
const Client = require("./client.js").default

const Table = require("cli-table3")

// MARK: Functions

// Get a new access token using the refresh token if the old one expires
function getNewAccessToken(instanceName) {
  return new Promise((resolve, reject) => {
    // Make an API call to the OAuth2 endpoint
    const tokenURL = "https://oauth2.googleapis.com/token"
    // POST request
    axios.post(tokenURL, null, {
      params: {
        // Pass the client ID, client secret and refresh token to ask for an access token
        client_id: store.get(`instances.${instanceName}.client_id`),
        client_secret: store.get(`instances.${instanceName}.client_secret`),
        refresh_token: store.get(`instances.${instanceName}.refresh_token`),
        grant_type: "refresh_token" // This tell Google to find the refresh token in the URL params, it does NOT mean return a refresh token
      }
    })
    .then(res => {
      // Store the access token and return
      const {access_token, refresh_token, expires_in} = res.data
      store.set(`instances.${instanceName}.access_token`, access_token)
      store.set(`instances.${instanceName}.last_refresh_time`, Math.floor(Date.now() / 1000))
      store.set(`instances.${instanceName}.token_expires_in`, expires_in)
      console.log(chalk.blue(`Refreshed access token successfully!`))
      resolve()
    })
    .catch(err => {
      error(err.message)
    })
  })
}

// MARK: GoogleDriveClient

class GoogleDriveClient extends Client {
  constructor() {
    super()
  }

  // Creates a new instance
  async newInstance() {
    const askForInstanceName = function() {
      return new Promise((resolve, reject) => {
        /*ask([
          {
            "name": "instanceName",
            "type": "input",
            "message": "What should this instance be named (usually a single letter, like a drive name):",
            "default": "g"
          }
        ])*/
        ask(new Input({
          name: "instanceName",
          message: "What should this instance be named (usually a single letter, like a drive name):",
          initial: "g"
        }))
        .then(instanceName => {
          store.set("current_instance_id", instanceName.toLowerCase())
          store.set(`instances.${instanceName}.provider_id`, "google_drive")
          resolve(instanceName)
        })
        .catch(err => {
          error(err.message)
          exit(1)
        })
      })
    }

    const askForCredFilePath = function(instanceName) {
      return new Promise((resolve, reject) => {
        console.log(
          chalk.yellow([
            `Set a project up ${link("here", "https://developers.google.com/drive/api/v3/quickstart/nodejs#step_1_turn_on_the")} first. Then follow these steps:\n` +
            `  - Click on the blue "Enable Drive API" button`,
            `  - Enter the name Dabbu CLI as the project name and click next`,
            `  - Select Server side app on the next screen and click next`,
            `  - Enter the redirect URI to be http://localhost:8081`,
            `  - On the last screen, click the blue "Download Client Configuration" button and save the file somewhere safe`,
            `  - Type in the path to the file you downloaded into the CLI`
          ].join("\n"))
        )
        /*ask([
          {
            "name": "pathToCredentialFile",
            "type": "input",
            "message": `Enter the path to the configuration file you downloaded:`
          }
        ])*/
        ask(new Input({
          name: "pathToCredentialFile",
          message: "Enter the path to the configuration file you downloaded:",
          default: "./creds/credentials.json"
        }))
        .then(pathToCredentialFile => {
          const fileContents = fs.readFileSync(pathToCredentialFile)
          const credentials = JSON.parse(fileContents)
          const {client_secret, client_id, redirect_uris} = credentials.web;
          store.set(`instances.${instanceName}.client_secret`, client_secret)
          store.set(`instances.${instanceName}.client_id`, client_id)
          store.set(`instances.${instanceName}.redirect_uri`, redirect_uris[0])
          resolve(instanceName)
        })
        .catch(err => {
          error(err.message)
          exit(1)
        })
      })
    }

    const getToken = function(instanceName) {
      return new Promise((resolve, reject) => {
        const clientId = store.get(`instances.${instanceName}.client_id`)
        const randomNumber = nanoid(24)
        const randomTextP1 = randomNumber.toString().substring(0, 12)
        const authURL = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=http%3A//localhost:8081&scope=https%3A//www.googleapis.com/auth/drive&state=${randomTextP1}&include_granted_scopes=true&response_type=code&access_type=offline`
        console.log(chalk.blue(`Authorize the app by visting this URL in a browser - ${authURL}`))
        const requestListener = function (req, res) {
          const query = url.parse(req.url, true).query
          res.statusCode = 200
          res.setHeader("Content-Type", "text/html")          
          res.end(`<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><title>Dabbu CLI Login Process</title><style media='screen'>body { background: #ECEFF1; color: rgba(0,0,0,0.87) font-family: Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; }#message { background: white; max-width: 360px; margin: 100px auto 16px; padding: 32px 24px 16px; border-radius: 3px; }#message h3 { color: #888; font-weight: normal; font-size: 16px; margin: 16px 0 12px; }#message h2 { color: #C4A000; font-weight: bold; font-size: 16px; margin: 0 0 8px; }#message h1 { font-size: 22px; font-weight: 300; color: rgba(0,0,0,0.6) margin: 0 0 16px;}#message p { line-height: 140%; margin: 16px 0 24px; font-size: 14px; }#message a { display: block; text-align: center; background: #039be5; text-transform: uppercase; text-decoration: none; color: white; padding: 16px; border-radius: 4px; }#message, #message a { box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24) }button { background-color: #C4A000; color: #cbcbcb; border-radius: 4px; border: 1px solid #e7e7e7; font-family: Roboto, Helvetica; font-size:14px; color: white; padding: 3px; }@media (max-width: 600px) {body, #message { margin-top: 0; background: white; box-shadow: none; }body { border-top: 16px solid #079632; }}</style><script>function copy() {let copyText = document.querySelector("#code")copyText.select()document.execCommand("copy")}document.querySelector("#copy-button").addEventListener("click", copy)</script></head><body><div id='message'><h2>Dabbu CLI Login Process</h2><h1>Copy authorization code</h1><p>Please copy the following code into the CLI to complete the sign in process<br><br><small><div id="code">${query.code}</div></small><button id="copy-button">Copy code</button></p></div></body></html>`)
          /*ask([
            {
              "name": "authCode",
              "type": "input",
              "message": `Enter the code that you just got in the browser:`
            }
          ])*/
          ask(new Input({
            name: "authCode",
            message: "Enter the code that you just got in the browser:",
            initial: "Looks like 4/something"
          }))
          .then(authCode => {
            const tokenURL = "https://oauth2.googleapis.com/token"
            axios.post(tokenURL, null, {
              params: {
                code: replaceAll(authCode, {"\'": "", "\"": "", " ": "", "%2F": "/"}),
                client_id: store.get(`instances.${instanceName}.client_id`),
                client_secret: store.get(`instances.${instanceName}.client_secret`),
                redirect_uri: store.get(`instances.${instanceName}.redirect_uri`),
                grant_type: "authorization_code"
              }
            })
            .then(res => {
              const {access_token, refresh_token, expires_in} = res.data
              store.set(`instances.${instanceName}.access_token`, access_token)
              store.set(`instances.${instanceName}.refresh_token`, refresh_token)
              store.set(`instances.${instanceName}.last_refresh_time`, Math.floor(Date.now() / 1000))
              store.set(`instances.${instanceName}.token_expires_in`, expires_in)
              console.log(chalk.blue(`Created ${instanceName}: successfully!`))
              resolve(instanceName)
            })
            .catch(err => {
              error(err.message)
              exit(1)
            })
          })
          .catch(err => {
            error(err.message)
            exit(1)
          })
        }
        
        const server = http.createServer(requestListener)
        server.listen(8081, "localhost")
      })
    }

    return waterfall([
      askForInstanceName,
      askForCredFilePath,
      getToken
    ])
  }

  // Returns the present working directory
  async pwd() {
    // Return string of format :instanceId/:currentPath, e.g. c:/Documents/Work
    return `${store.get("current_instance_id")}:${store.get(`instances.${store.get("current_instance_id")}.current_path`) || ""}`
  }

  // Move into a directory by saving it in the config
  async cd(input) {
    // Parse the command to get the relative path
    const inputPath = replaceAll(input, {"cd ": "", "cd": "", "//": "/"})
    // Parse the relative path to get an absolute one
    const path = parsePath(store.get(`instances.${store.get("current_instance_id")}.current_path`) || "", inputPath)
    // Save the new path
    return store.set(`instances.${store.get("current_instance_id")}.current_path`, path)
  }

  // List out files and folders by sending an API call to the server
  async ls(input) {
    // Get the current instance ID so we can get variables from the config file
    const currentInstance = store.get("current_instance_id")

    // Check if our access token has expired
    // Get the last time it was refreshed
    const lastRefreshTime = store.get(`instances.${currentInstance}.last_refresh_time`)
    // Get the expiry time in seconds from the last refresh time
    const expiry = store.get(`instances.${currentInstance}.token_expires_in`)
    // Check if we are overdue
    if (lastRefreshTime + expiry <= Math.floor(Date.now() / 1000)) {
      // If so, refresh the access token
      await getNewAccessToken(currentInstance)
    }
    // Get the access token and put it in the header
    const accessToken = store.get(`instances.${currentInstance}.access_token`)

    // Parse the command to get the relative path
    const inputPath = replaceAll(input, {"ls ": "", "ls": "", "//": "/"})
    // Parse the relative path to get an absolute one
    const path = parsePath(store.get(`instances.${currentInstance}.current_path`) || "/", inputPath ? inputPath: "")
    // Show a loading indicator
    const spinner = ora(`Loading your ${chalk.blue("files and folders")}`).start()

    // Create an axios instance so the headers carry on to the requests
    const instance = axios.create({
      baseURL: store.get("server_address"),
      headers: {"Authorization": `Bearer ${accessToken}`} // Put it in the authorization header
    })

    // The URL to send the request to
    const url = `/dabbu/v1/api/data/${encodeURIComponent(store.get("current_provider_id"))}/${encodeURIComponent(path === "" ? "/" : path)}`
    // GET request
    return instance.get(url)
      .then(res => {
        if (res.data.content.length > 0) {
          // If there are some files, loop through them
          const files = res.data.content
          // Append the files to this table and then display them
          const table = new Table({head: [chalk.green("Name"), chalk.green("Size"), chalk.green("Download Link")], colWidths: [30, 10, 40]})
          for (let i = 0, length = files.length; i < length; i++) {
            const file = files[i]
            const contentURI = replaceAll(file.contentURI || "", {" ": "%20"})
            table.push([
              file.kind === "folder" ? chalk.blueBright(file.name) : chalk.magenta(file.name), // File name - blue if folder, magenta if file
              `${!file.size ? "-" : Math.floor(file.size / (1024 * 1024))} MB`, // File size in MB
              link(!contentURI ? "No download link" : `${contentURI.substring(0, 34)}`, contentURI) // Download link
            ])
          }
          // We got the result, stop loading
          spinner.stop()
          // Print out the table
          console.log(table.toString())
        } else {
          // We have no files, stop loading
          spinner.stop()
          // Tell the user the folder is empty
          error("Folder is empty")
        }
      })
      .catch(err => {
        // We have an error, stop loading
        spinner.stop()
        if (err.response) {
          // Request made and server responded
          error(`An error occurred: ${err.response.data ? err.response.data.error.message : "Unkown Error"}`)
        } else if (err.request) {
          // The request was made but no response was received
          error(`An error occurred: No response was received: ${err.message}`)
        } else {
          // Something happened in setting up the request that triggered an Error
          console.error(err)
          error(`An error occurred while sending the request: ${err.message}`)
        }
      })
  }

  // Return a single file's information by sending an API call to the server
  async cat(input) {
    // Get the current instance ID so we can get variables from the config file
    const currentInstance = store.get("current_instance_id")

    // Check if our access token has expired
    // Get the last time it was refreshed
    const lastRefreshTime = store.get(`instances.${currentInstance}.last_refresh_time`)
    // Get the expiry time in seconds from the last refresh time
    const expiry = store.get(`instances.${currentInstance}.token_expires_in`)
    // Check if we are overdue
    if (lastRefreshTime + expiry <= Math.floor(Date.now() / 1000)) {
      // If so, refresh the access token
      await getNewAccessToken(currentInstance)
    }
    // Get the access token and put it in the header
    const accessToken = store.get(`instances.${currentInstance}.access_token`)

    // Parse the command for the relative path
    const inputPath = replaceAll(input, {"cat ": "", "cat": "", "//": "/"})
    // Get an array of folder names from the path
    const folderPath = inputPath.split("/")
    // Get the file name
    const fileName = folderPath.pop()
    // Now parse the folder path to get an absolute one
    const path = parsePath(store.get(`instances.${currentInstance}.current_path`) || "", folderPath.join("/"))
    // Show a loading indicator
    const spinner = ora(`Fetching ${chalk.blue(fileName)}`).start()

    // Create an axios instance so the headers carry on to the requests
    // No base URL here because we are making a request to another file as well
    const instance = axios.create({
      headers: {"Authorization": `Bearer ${accessToken}`, "Access-Control-Allow-Origin": "*" } // Put it in the authorization header
    })

    // The URL to send the GET request to
    let url = `${store.get("server_address")}/dabbu/v1/api/data/${encodeURIComponent(store.get("current_provider_id"))}/${encodeURIComponent(path === "" ? "/" : path)}/${encodeURIComponent(fileName)}`
    // GET request
    return instance.get(url, {
      params: {
        // This is required so the server's Google Drive provider will return a link that we can access through curl/axios
        exportType: "media"
      }
    })
      .then(res => {
        if (res.data.content) {
          // If we have a file, download it using the content URI
          const file = res.data.content
          // The URL to download it from
          url = file.contentURI
          if (file.contentURI) {
            // If there is a contentURI
            // GET request
            return instance.get(url, { responseType: "stream" })
              .then(async res => {
                if (res.data) {
                  // Download it to the downloads folder
                  const ext = getExtFromMime(file.mimeType)
                  const downloadFilePath = parsePath(__dirname,`../../downloads/${fileName}${ext && fileName.indexOf(ext) === -1 ? `.${ext}` : ""}`)
                  // Create the file
                  await fs.createFile(downloadFilePath)
                  // Open a write stream so we can write the data we got to it
                  const writer = fs.createWriteStream(downloadFilePath)
                  // Pipe the bytes to the file
                  res.data.pipe(writer)
                  return new Promise((resolve, reject) => {
                    writer.on('finish', () => {
                      // Stop loading, we got the file
                      spinner.stop()
                      // Tell them we downloaded it
                      console.log(
                        chalk.yellow(
                          `File download to ${downloadFilePath}`
                        )
                      )
                      // Ask the user if they want to open the download the file
                      ask(new Confirm({
                        "name": "confirm",
                        "message": "Do you want to open it?"
                      }))
                      .then(confirm => {
                        if (confirm) {
                          // Open the file
                          open(downloadFilePath, { wait: false })
                        }
                        // Return from the promise
                        resolve()
                      })
                    })
                    writer.on('error', err => {
                      // Stop loading, we have an error
                      spinner.stop()
                      // Error out
                      error(err)
                      // Don't reject else it will throw an unhandled promise rejection error
                    })
                  })
                } else {
                  // We have no response, stop loading
                  spinner.stop()
                  // Tell the user the server responded with an empty body
                  error("An error occurred: server responded with an empty response body")
                }
              })
              .catch(err => {
                // We have an error, stop loading
                spinner.stop()
                if (err.response) {
                  // Request made and server responded
                  error(`An error occurred: ${err.response.data ? err.response.data.error.message : "Unkown Error"}`)
                } else if (err.request) {
                  // The request was made but no response was received
                  error(`An error occurred: No response was received: ${err.message}`)
                } else {
                  // Something happened in setting up the request that triggered an Error
                  error(`An error occurred while sending the request: ${err.message}`)
                }
              })
          } else {
            spinner.stop()
            error("File/folder couldn't be downloaded, no download link available. Folders do not have a download link in Google Drive.")
          }
        } else {
          // We have no response, stop loading
          spinner.stop()
          // Tell the user the server responded with an empty body
          error("An error occurred: server responded with an empty response body")
        }
      })
      .catch(err => {
        // We have an error, stop loading
        spinner.stop()
        if (err.response) {
          // Request made and server responded
          error(`An error occurred: ${err.response.data ? err.response.data.error.message : "Unkown Error"}`)
        } else if (err.request) {
          // The request was made but no response was received
          error(`An error occurred: No response was received: ${err.message}`)
        } else {
          // Something happened in setting up the request that triggered an Error
          error(`An error occurred while sending the request: ${err.message}`)
        }
      })
  }

  // Copy a file from one location to another
  async cp(input) {
    // Get the current instance ID so we can get variables from the config file
    const currentInstance = store.get("current_instance_id")

    // Check if our access token has expired
    // Get the last time it was refreshed
    const lastRefreshTime = store.get(`instances.${currentInstance}.last_refresh_time`)
    // Get the expiry time in seconds from the last refresh time
    const expiry = store.get(`instances.${currentInstance}.token_expires_in`)
    // Check if we are overdue
    if (lastRefreshTime + expiry <= Math.floor(Date.now() / 1000)) {
      // If so, refresh the access token
      await getNewAccessToken(currentInstance)
    }
    // Get the access token and put it in the header
    const accessToken = store.get(`instances.${currentInstance}.access_token`)

    // Parse the command for two relative paths - one to the original file and second to where it should be copied
    const inputPath = replaceAll(input, {"cp ": "", "cp": "", "//": "/"})

    // Check if the required arguments exist
    if (inputPath.split(" ").length < 2) {
      // Else error out
      error("Must have a path to the file to copy and the folder path to copy it to")
      return
    }

    // The path to the file to copy
    const fromFolderPath = inputPath.split(" ")[0]
    // The location to copy it to
    const toFolderPath = inputPath.split(" ")[1]
    // Get the file name
    const fileName = fromFolderPath.split("/").pop()
    // Now parse the folder paths to get absolute ones
    const fromPath = parsePath(store.get(`instances.${currentInstance}.current_path`) || "", fromFolderPath.split("/").slice(0, -1).join("/"))
    const toPath = parsePath(store.get(`instances.${currentInstance}.current_path`) || "", toFolderPath)
    // Show a loading indicator
    const spinner = ora(`Copying ${chalk.blue(fileName)} to ${toPath}`).start()

    // Create an axios instance so the headers carry on to the requests
    // No base URL here because we are making a request to another file as well
    const instance = axios.create({
      headers: {"Authorization": `Bearer ${accessToken}`, "Access-Control-Allow-Origin": "*" } // Put it in the authorization header
    })

    // The URL to send the request to
    let url = `${store.get("server_address")}/dabbu/v1/api/data/${encodeURIComponent(store.get("current_provider_id"))}/${encodeURIComponent(fromPath === "" ? "/" : fromPath)}/${encodeURIComponent(fileName)}`
    // GET request
    return instance.get(url, { 
        params: {
          // This is required so the server's Google Drive provider will return a link that we can access through curl/axios
          exportType: "media"
        }
      })
      .then(async res => {
        if (res.data.content) {
          // If we have a file, download it then upload it again
          const file = res.data.content
          // Get the data as a stream
          const response = await instance.get(file.contentURI, { responseType: "stream" })
          // To upload the data as a file, we need to store it in a file first
          // Path to the file
          const downloadFilePath = parsePath(__dirname,`../../downloads/${fileName}`)
          // Create the file
          await fs.createFile(downloadFilePath)
          // Open a write stream so we can write the data we got to it
          const writer = fs.createWriteStream(downloadFilePath)
          // Pipe the bytes to the file
          response.data.pipe(writer)
          // Now upload it as form data
          const formData = new FormData()
          // Add it to the content field
          formData.append("content", fs.createReadStream(downloadFilePath), { filename: fileName })

          // POST request
          url = `${store.get("server_address")}/dabbu/v1/api/data/${encodeURIComponent(store.get("current_provider_id"))}/${encodeURIComponent(toPath === "" ? "/" : toPath)}/${encodeURIComponent(fileName)}`
          return instance.post(url, 
            formData, 
            {
              headers: {
                "Authorization": `Bearer ${accessToken}`, 
                "Access-Control-Allow-Origin": "*", 
                ...formData.getHeaders()
              }
            }
          )
          .then(res => {
            // We have the result, stop loading
            spinner.stop()
            console.log(
              chalk.yellow(
                `Copied ${chalk.blue(fileName)} to ${toPath}`
              )
            )
          })
          .catch(err => {
            // We have an error, stop loading
            spinner.stop()
            if (err.response) {
              // Request made and server responded
              error(`An error occurred while moving the file: ${err.response.data ? err.response.data.error.message : "Unkown Error"}`)
            } else if (err.request) {
              // The request was made but no response was received
              error(`An error occurred: No response was received: ${err.message}`)
            } else {
              // Something happened in setting up the request that triggered an Error
              error(`An error occurred while sending the request: ${err.message}`)
            }
          })
        } else {
          // We have no response, stop loading
          spinner.stop()
          // Tell the user the server responded with an empty body
          error("An error occurred: server responded with an empty response body")
        }
      })
      .catch(err => {
        // We have an error, stop loading
        spinner.stop()
        if (err.response) {
          // Request made and server responded
          error(`An error occurred: ${err.response.data ? err.response.data.error.message : "Unkown Error"}`)
        } else if (err.request) {
          // The request was made but no response was received
          error(`An error occurred: No response was received: ${err.message}`)
        } else {
          // Something happened in setting up the request that triggered an Error
          error(`An error occurred while sending the request: ${err.message}`)
        }
      })
  }

  // Delete a file by sending an API call to the server
  async rm(input) {
    // Get the current instance ID so we can get variables from the config file
    const currentInstance = store.get("current_instance_id")

    // Check if our access token has expired
    // Get the last time it was refreshed
    const lastRefreshTime = store.get(`instances.${currentInstance}.last_refresh_time`)
    // Get the expiry time in seconds from the last refresh time
    const expiry = store.get(`instances.${currentInstance}.token_expires_in`)
    // Check if we are overdue
    if (lastRefreshTime + expiry <= Math.floor(Date.now() / 1000)) {
      // If so, refresh the access token
      await getNewAccessToken(currentInstance)
    }
    // Get the access token and put it in the header
    const accessToken = store.get(`instances.${currentInstance}.access_token`)

    // Parse the command for the relative path
    const inputPath = replaceAll(input, {"rm ": "", "rm": "", "//": "/"})
    // Get an array of folder names from the path
    const folderPath = inputPath.split("/")
    // Get the file name
    const fileName = folderPath.pop()
    // Now parse the folder path to get an absolute one
    const path = parsePath(store.get(`instances.${currentInstance}.current_path`) || "", folderPath.join("/"))
    // Show a loading indicator
    const spinner = ora(`Deleting ${chalk.blue(fileName)}`).start()

    // Create an axios instance so the headers carry on to the requests
    const instance = axios.create({
      baseURL: store.get("server_address"),
      headers: {"Authorization": `Bearer ${accessToken}`} // Put it in the authorization header
    })

    // The URL to send the DELETE request to
    const url = `${store.get("server_address")}/dabbu/v1/api/data/${encodeURIComponent(store.get("current_provider_id"))}/${encodeURIComponent(path === "" ? "/" : path)}/${encodeURIComponent(fileName)}`
    // DELETE request
    return instance.delete(url)
      .then(res => {
        // Done, stop loading
        spinner.stop()
        // Tell the user
        console.log(`File ${fileName} was deleted successfully`)
      })
      .catch(err => {
        // We have an error, stop loading
        spinner.stop()
        if (err.response) {
          // Request made and server responded
          error(`An error occurred: ${err.response.data ? err.response.data.error.message : "Unkown Error"}`)
        } else if (err.request) {
          // The request was made but no response was received
          error(`An error occurred: No response was received: ${err.message}`)
        } else {
          // Something happened in setting up the request that triggered an Error
          error(`An error occurred while sending the request: ${err.message}`)
        }
      })
  }
}

// MARK: Export

// Export the client as the default export
exports.default = GoogleDriveClient