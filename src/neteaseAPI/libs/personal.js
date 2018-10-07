const Base = require('../base')
class Personal extends Base {
  /**
   * 创建歌单
   * @param {string} 歌单名称
   * @returns {Promise<object>}
   */
  async createPlaylist (name) {
    if (typeof name !== 'string') {
      name = name.toString()
    }
    const data = {
      name: name,
      csrf_token: ''
    }
    return this.requestWithSetCookie(
      'music.163.com',
      '/weapi/playlist/create',
      'POST',
      data,
      'os=PC; Path=/;'
    )
  }

  /**
   * 每日推荐歌曲 (日推)
   * @returns {Promise<object>}
   */
  async recommendSongs () {
    return this.requestWithSetCookie(
      'music.163.com',
      '/weapi/v1/discovery/recommend/songs',
      'POST',
      {
        offset: 0,
        total: true,
        limit: 20,
        csrf_token: ''
      }
    )
  }
  /**
   * 每日歌单推荐
   * @returns {Promise<object>}
   */
  async recommendPlaylists () {
    return this.requestWithSetCookie(
      'music.163.com',
      '/weapi/v1/discovery/recommend/resource',
      'POST', {
        csrf_token: ''
      }
    )
  }
  /**
   * 个人 FM
   * @returns {Promise<object>}
   */
  async personalFM () {
    return this.requestWithSetCookie(
      'music.163.com',
      '/weapi/v1/radio/get',
      'POST', {
        csrf_token: ''
      }
    )
  }
}

module.exports = Personal
