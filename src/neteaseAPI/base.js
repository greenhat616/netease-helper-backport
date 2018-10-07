// 导入包
const User = require('./user')
const winston = require('winston')
const _ = require('lodash')
const {
  createWebAPIRequest
} = require('./utils/requests')

class base {
  get cookie() {
    return this.user && this.user.cookie ? this.user.cookie : []
  }

  async checkCookieValid () {
    // 用于检测 Cookie 有效期限

  }
  
  get isLogin() {
    return !!this.user && Array.isArray(this.user.cookie) && this.user.cookie.length > 1
  }

  completeCookie() {
    const cookie = completeCookie(this.user.cookie)
    if (!cookie) {
      return false
    } else {
      this.user.cookie = cookie
      return true
    }
  }
  /**
   * 从存储当中恢复用户
   * @param {object} store 用户的信息，用于恢复使用
   */
  load(store) {
    this.user = new User(store)
  }

  checkLogin() {
    if (!this.isLogin) {
      throw new Error('Need Login!')
    }
  }

  async request(host, path, method, payload = {
    csrf_token: ''
  }) {
    return (await createWebAPIRequest(host, path, method, payload, this.cookie)).data
  }

  async requestWithSetCookie(host, path, method, payload = {
    csrf_token: '',
  }, cookie = []) {
    let Submitcookie
    if (cookie && cookie) {
      // 存在附加 cookie
      const extraCookie = Array.isArray(cookie) ? cookie : [cookie]
      Submitcookie = _.concat(extraCookie, this.cookie)
    } else {
      Submitcookie = this.cookie
    }

    const respData = await createWebAPIRequest(host, path, method, payload, Submitcookie)
    if (respData.data.code === 301) {
      winston.verbose(this.cookie)
      winston.verbose(respData)
    }
    if (!this.user && !(respData.data && respData.data.loginType)) {
      if (!respData.data || !respData.data.msg) {
        winston.error('在尝试登录时遇到错误: 无法获取到响应信息， 可能是网络错误')
      } else {
        winston.error('在尝试登录时遇到错误: ' + respData.data.msg)
      }
      // 退出进程
      process.exit(1)
    }
    const userData = {
      cookie: respData.cookie && respData.cookie.length > 1 ? respData.cookie : this.cookie,
      data: respData.data && respData.data.loginType ? respData.data : this.user.info
    }
    this.user = new User(userData)
    return respData.data
  }
}

function randomString(pattern, length) {
  return Array.apply(null, {
    length: length
  }).map(() => (pattern[Math.floor(Math.random() * pattern.length)])).join('')
}

function completeCookie(cookie) {
  let origin = (cookie || '').split(/;\s*/).map(element => (element.split('=')[0])),
    extra = []
  let now = (new Date).getTime()

  if (!origin.includes('JSESSIONID-WYYY')) {
    let expire = new Date(now + 1800000) //30 minutes 
    let jessionid = randomString('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKMNOPQRSTUVWXYZ\\/+', 176) + ':' + expire.getTime()
    extra.push(['JSESSIONID-WYYY=' + jessionid, 'Expires=' + expire.toGMTString()])
  }
  if (!origin.includes('_iuqxldmzr_')) {
    let expire = new Date(now + 157680000000) //5 years
    extra.push(['_iuqxldmzr_=32', 'Expires=' + expire.toGMTString()])
  }
  if ((!origin.includes('_ntes_nnid')) || (!origin.includes('_ntes_nuid'))) {
    let expire = new Date(now + 3153600000000) //100 years
    let nnid = randomString('0123456789abcdefghijklmnopqrstuvwxyz', 32) + ',' + now
    extra.push(['_ntes_nnid=' + nnid, 'Expires=' + expire.toGMTString()])
    extra.push(['_ntes_nuid=' + nnid.slice(0, 32), 'Expires=' + expire.toGMTString()])
  }
  return extra
}
module.exports = base
