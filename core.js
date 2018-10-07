// 载入必要的包
const nconf = require('nconf')
const {
  CronJob
} = require('cron')
const path = require('path')
const winston = require('winston')
const fs = require('fs')
// const { promisify } = require('util')
const {
  preStart
} = require('./src/preStart')

// 载入网易云 API
const API = require('./src/neteaseAPI/entrance')
const api = new API()

// 提速 Promise
global.Promise = require('bluebird')

// 声明常量
// const pkg = require('./package')
const userFile = path.join(__dirname, 'data/user.json')
const playlistFile = path.join(__dirname, 'data/playlist.json')
const statusFile = path.join(__dirname, 'data/status.json')
const logFile = path.join(__dirname, 'data/data.log')

// 注册环境
preStart(logFile)

// 初始化
async function init () {
  // 判断用户数据是否存在
  if (!fs.existsSync(userFile)) {
    // 数据不存在
    try {
      winston.verbose('开始尝试自动登录')
      winston.debug(`账户:${nconf.get('user:cellphone')}, 密码: ${nconf.get('user:password')}`)
      await api.cellphoneLogin(nconf.get('user:cellphone'), nconf.get('user:password'))
    } catch (e) {
      // 估计就是密码错误了...
      winston.error(e)
      process.exit(1)
    }
    // 保存用户数据
    winston.verbose('保存用户数据..')
    fs.writeFileSync(userFile, JSON.stringify(api.user.toJSON()))
  } else {
    // 存在用户数据, 更新一下登录状态
    winston.verbose('存在用户数据， 自动导入')
    api.load(require(userFile))
    winston.verbose('刷新登录状态...')
    await api.refreshLogin()

    // 更新用户数据
    winston.verbose('更新用户数据...')
    fs.writeFileSync(userFile, JSON.stringify(api.user.toJSON()))
  }
  // 调用个需要登录的接口， 测试下信息是否有效
  winston.verbose('测试用户数据是否有效...')
  const response = await api.isLogin
  if (!response) {
    // 清除用户数据
    fs.unlinkSync(userFile)
    winston.error('登录状态失效， 终结进程进行重新尝试')
    process.exit(1)
  }
  winston.verbose('接口初始化完成！')
}

async function autoAddRecommendSongs () {
  // 嗯， 这个函数就是自动收藏日推的核心函数
  // 先检测， 是否已完成该任务
  winston.verbose('读取状态文件...')
  const Status = fs.existsSync(statusFile) ? require(statusFile) : {}
  const date = new Date().toDateString()
  if (Status[date] && Status[date].dailyAdd) {
    // 该任务已经完成过了
    winston.verbose('今天已经收藏过日推了， 跳过任务。')
    return
  }
  if (!Status[date]) {
    Status[date] = {}
  }
  const now = new Date()
  const year = now.getFullYear().toString()
  const month = (now.getMonth() + 1).toString().length < 2 ? `0${(now.getMonth() + 1).toString()}` : (now.getMonth() + 1).toString()
  let playlistName = `${year}.${month}` // 类似 2018.05
  // 增加个性化设置
  if (nconf.get('playlistName')) {
    playlistName = nconf.get('playlistName').replace('%Y', year).replace('%M', month)
  }
  // 解析 playlistFile
  winston.verbose('开始解析歌单文件...')
  const playlists = fs.existsSync(playlistFile) ? require(playlistFile) : {}
  if (!playlists[playlistName]) {
    // 不存在歌单
    winston.verbose('未发现本月收藏歌单， 开始自动创建...')
    const response = await api.createPlaylist(playlistName)
    if (response.code !== 200) {
      winston.error('创建歌单失败, 错误信息: ' + response.msg)
      throw new Error('创建歌单失败！')
    }

    // 保存歌单数据
    const playlistId = response.id
    playlists[playlistName] = playlistId
    winston.verbose('歌单创建成功。 歌单ID: ' + playlistId)
    fs.writeFileSync(playlistFile, JSON.stringify(playlists))
    winston.verbose('将歌单数据写入歌单文件...')
  }

  const playlistId = playlists[playlistName]

  // 注册歌曲 ID
  winston.verbose('开始获取日推歌曲ID...')
  const songIds = []
  if (typeof Status[date] !== 'object') {
    Status[date] = {}
  }
  if (Status[date].Songs) {
    for (let song of Status[date].Songs) {
      songIds.push(song.id)
    }
    winston.verbose('检测到状态数据中已经存在歌曲数据，读取完毕。')
  } else {
    // 获取日推
    winston.verbose('开始获取日推列表...')
    const recommendSongsDaily = await api.recommendSongs()
    if (!recommendSongsDaily.code || recommendSongsDaily.code !== 200) {
      winston.verbose(recommendSongsDaily)
      winston.error('获取日推失败!')
      throw new Error('获取日推失败')
    }
    winston.verbose('开始分析日推列表...')
    Status[date].Songs = []
    for (let song of recommendSongsDaily.recommend) {
      // 迭代写入歌曲ID
      songIds.push(song.id)
      Status[date].Songs.push({
        name: song.name,
        id: song.id
      })
    }
    // 保存状态
    winston.verbose('保存状态数据...')
    fs.writeFileSync(statusFile, JSON.stringify(Status))
  }
  // 写入歌单
  const response = await api.addSongs(playlistId, songIds)
  if (!response.code || response.code !== 200) {
    if (response && response.code === 502) {
      winston.verbose('歌单部分歌曲重复， 已跳过部分')
    } else {
      winston.error('写入歌单失败')
      winston.verbose(response)
      throw new Error('写入歌单失败');
    }
  }

  // 保存状态
  winston.verbose('收藏日推完成， 保存状态数据到本地')
  Status[date].dailyAdd = true
  fs.writeFileSync(statusFile, JSON.stringify(Status))
}

async function autoSign () {
  // 每日自动签到
  winston.verbose('开始读取状态数据...')
  const Status = fs.existsSync(statusFile) ? require(statusFile) : {}
  const date = new Date().toDateString()
  if (Status[date] && Status[date].sign) {
    winston.verbose('今天已经签到过了， 跳过任务。')
    return
  }
  if (!Status[date]) {
    Status[date] = {}
  }
  const signResult = await Promise.all([api.sign(0), api.sign(1)])
  if (!(signResult[0] && signResult[1]) || signResult[0].code !== 200 || signResult[1].code !== 200) {
    if (signResult[0] && signResult[0].code === -2) {
      winston.verbose('移动端已经签到过了, 跳过')
    } else if (signResult[1] && signResult[1].code === -2) {
      winston.verbose('PC 端已经签到过了, 跳过')
    } else {
      winston.verbose(signResult)
      winston.error('签到失败。')
      throw new Error('签到失败')
    }
  }

  // 写入状态
  winston.verbose('签到完成。 保存状态数据...')
  Status[date].sign = true
  fs.writeFileSync(statusFile, JSON.stringify(Status))
}

async function startCronJob () {
  // 主要任务
  let mainJobCronTime = '0 0 */1 * * *'
  if (nconf.get('loopHour')) {
    const Hour = nconf.get('loopHour')
    mainJobCronTime = `0 0 0/${Hour} * * *`
  }
  const mainJob = new CronJob({
    cronTime: mainJobCronTime,
    onTick: () => {
      let startTime
      Promise.resolve()
        .then(() => {
          winston.info(`当前时间: ${new Date().toLocaleString()}, 开始执行定时任务。`)
          startTime = Date.now()
        })
        .then(autoSign)
        .then(autoAddRecommendSongs)
        .then(() => {
          winston.info(`本次任务已经全部执行完毕, 耗时: ${Date.now() - startTime}ms.`)
        })
        .catch(err => {
          console.error(err)
          winston.error('在执行计划任务的过程中遇到问题， 这通常可能是 Cookie 错误。 为了您的账户安全， 程序将会终止。 强烈建议您使用 pm2 挂本接口。')
          fs.unlinkSync(userFile)
          process.exit(1)
        })
    },
    onComplete: () => {
      winston.error('Main Job is stopped. Restart it.')
      mainJob.start()
    },
    start: false,
    timeZone: 'Asia/Shanghai'
  })

  // 日推歌曲， 任务。 每天 6 时  1 分清除状态。 并执行收藏任务。
  let clearJobCronTime = '0 1 6 * * *'
  if (nconf.get('dailyRestTime')) {
    const HourAndMinute = nconf.get('dailyRestTime').spilt(':')
    clearJobCronTime = `0 ${HourAndMinute[0]} ${HourAndMinute[1]} * * *`
  }
  const clearJob = new CronJob({
    cronTime: clearJobCronTime, // 秒 分钟 小时 日 月 星期x
    onTick: () => {
      // 读取状态文件
      winston.verbose(`现在是: ${new Date().toDateString()}, 开始清除状态以便收藏日推。`)
      winston.verbose('读取状态文件...')
      const Status = fs.existsSync(statusFile) ? require(statusFile) : {}
      const date = new Date().toDateString()
      if (!Status[date]) {
        Status[date] = {}
      }

      winston.verbose('清除状态信息')
      delete Status[date].Songs
      delete Status[date].dailyAdd

      winston.verbose('保存状态信息')
      fs.writeFileSync(statusFile, JSON.stringify(Status))

      // 执行一波收藏日推
      autoAddRecommendSongs()
      .catch(err => {
        console.error(err)
        winston.error('在执行计划任务的过程中遇到问题， 这通常可能是 Cookie 错误。 为了您的账户安全， 程序将会终止。 强烈建议您使用 pm2 挂本接口。')
        fs.unlinkSync(userFile)
        process.exit(1)
      })
    },
    onComplete: () => {
      winston.error('Clear Job is stopped. Restart it.')
      clearJob.start()
    },
    start: false,
    timeZone: 'Asia/Shanghai'
  })

  // 启动 CronJob
  clearJob.start()
  mainJob.start()
  if (!clearJob.running || !mainJob.running) {
    winston.error('定时任务启动失败， 终结进程。')
  }
}

// 启动应用
winston.info('开始尝试模块测试...')
global.startTime = Date.now()
Promise.resolve()
  .then(init)
  // 出于测试的目的， 所以每次打开会按序执行一遍 CronJob 会执行的任务
  .then(autoSign)
  .then(autoAddRecommendSongs)
  // .then(PlayDailyPlaylist)

  // 启动 CronJob
  .then(startCronJob)

  // 完成
  .then(() => {
    winston.info(`耗时: ${Date.now() - global.startTime}ms. 执行模块测试完成。测试通过。激活定时任务成功。`)
    delete global.startTime
  })
  .catch(err => {
    winston.error(`耗时: ${Date.now() - global.startTime}ms. 模块测试失败， 为了保护您的账户安全， 程序自动退出。`)
    winston.error(err)
    process.exit(1)
  })
