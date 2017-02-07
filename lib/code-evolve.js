'use babel';

import CodeEvolveView from './code-evolve-view';
import { CompositeDisposable } from 'atom';

export default {

  codeEvolveView: null,
  modalPanel: null,
  subscriptions: null,

  charTypingDelay: 10,
  lineTypingDelay: 35,
  animateTyping: true,
  animateLimit: 10,
  animateCounter: 0,
  lastCursorPosition: null,

  rowHeight:21,

  _isRunning:false,

  activate(state) {

    this.codeEvolveView = new CodeEvolveView(state.codeEvolveViewState);
    this.modalPanel = atom.workspace.addModalPanel({
      item: this.codeEvolveView.getElement(),
      visible: false
    });

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register command that toggles this view
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'code-evolve:toggle': () => this.parseGitLog()
    }));
  },

  deactivate() {
    this.modalPanel.destroy();
    this.subscriptions.dispose();
    this.codeEvolveView.destroy();
  },

  serialize() {
    return {
      codeEvolveViewState: this.codeEvolveView.serialize()
    };
  },

  insertTextAnimated(text) {

    let self = this
    let p = new Promise( (resolve, reject) => {

      let pp = this
      let ln = 1

      if (!self.animateTyping)
        ln = text.length

      for(let i=0;i<4 && i<text.length-2; i++) {
        if (text[i] == text[0]) {
          ln++
          continue
        }
      }

      let c = text.substring(0,ln)
      let t = text.substring(ln)
      let editor

      if (editor = atom.workspace.getActiveTextEditor()) {
        editor.autoIndent = false
        editor.insertText(c)
      }

      setTimeout(function() {
        resolve(t)
      }, self.charTypingDelay)

    })

    return p.then( function(text) {
      if (text.length > 0) {
        return self.insertTextAnimated(text)
      } else {
        return true
      }
    })
  },

  moveCursor(p) {
    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      editor.setCursorBufferPosition(p)
      editor.setCursorScreenPosition(p)
    }
  },

  executeCommands(commands) {
    let self = this

    let c = commands[0]
    commands.splice(0, 1)
    let p = new Promise( (resolve, reject) => {

      if (c[0] == "line") {
        // console.log("line:" + c[1])

        if (self.animateLimit != -1)
          self.animateTyping = (self.animateCounter--) > 0;

        // self.scrollBy(-1)
        self.insertTextAnimated(c[1]).then( function() {

          let editor
          if (editor = atom.workspace.getActiveTextEditor())
            editor.insertNewline()

          setTimeout(function() {
            resolve(commands)
          }, self.lineTypingDelay)

        })

      } else if (c[0] == "cursor") {

        self.animateCounter = self.animateLimit

        let deleteRow = c[1]
        let deleteRowCount = c[2]
        let insertRow = c[3]

        console.log("cursor:-" + c[1] + ",+" + c[3])

        let editor
        if (editor = atom.workspace.getActiveTextEditor()) {
          let pos = { row: deleteRow, column: 0 }
          self.moveCursor(pos)
          self.lastCursorPosition = pos
        }
        resolve(commands)

      } else if (c[0] == "delete") {
        // console.log("delete:" + c[1])
        let editor
        if (editor = atom.workspace.getActiveTextEditor()) {
          let found = self.scrollToText(c[1])
          if (!found) {
            if (self.lastCursorPosition != null) {
              // editor.
              self.moveCursor(self.lastCursorPosition)
              found = self.scrollToText(c[1])
            }
          }

          if (!found) {
            console.log("delete not found: " + c[1])
          } else {
            editor.deleteLine()
          }

        }
        resolve(commands)
      } else if (c[0] == "find") {
        // console.log("find:" + c[1])
        self.scrollToText(c[1], 1)
        resolve(commands)

      } else if (c[0] == "file") {
        console.log("file:" + c[1])
        self.lastCursorPosition = null
        atom.workspace.open(c[1]).then( function() {

          setTimeout(function() {

            self.moveCursor({row:0,column:0})
            resolve(commands)
          }, self.lineTypingDelay * 20)

        })

      } else {
        console.log("oops " + c[0])
        resolve(commands)
      }

    })

    return p.then(function(commands) {
      if (!self._isRunning)
        return
      if (commands.length > 0) {
        return self.executeCommands(commands)
      }
      return true
    })
  },

  scrollBy(i) {
    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      let p = editor.getCursorScreenPosition()
      p.row = p.row + i
      self.moveCursor(p)
    }
  },

  scrollToText(text, after = 0) {
    let self = this

    text = text.replace(" ", "")
    text = text.replace("\t", "")
    text = text.replace("\n", "")

    // if (text.length == 0)
    //   return false

    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      // console.log("find!:" + text)
      let p = editor.getCursorScreenPosition()
      for(let i=p.row-1; i<p.row+40; i++) {
        if (i < 0)
          i = 0
        self.moveCursor({ row: i, column: 0 })
        let t = editor.lineTextForBufferRow(i)
        if (t == null)
          t = editor.lineTextForScreenRow(i)

        if (t == null)
          continue

        t = t.replace(" ", "")
        t = t.replace("\t", "")
        t = t.replace("\n", "")

        if (t == text) {
          console.log("found:" + text + "|" + t)
          if (after > 0) {
            for(let j=0;j<after;j++) {
              self.moveCursor({ row: i + after, column: 0 })
            }
          }
          return true
        }

        if (text.length == 0)
          break
      }

      self.moveCursor(p)
      return false
    }
  },

  parseDiffs(diffs, lines) {
    let self = this

    let commands = []

    for(let i=0; i<diffs.length; i++) {
      let d = diffs[i]
      for(let j=d; j<lines.length; j++) {
        let l = lines[j]

        if (l.startsWith("diff ") && j!=d) {
            break
        }

        if (l.startsWith("diff ")) {
          let ss = l.split(" b/")
          let file = ss[ss.length-1]
          commands.push([ 'file', file ])
          continue
        }

        if (l.startsWith("commit "))
          break;

        if (l.startsWith("@@")) {
          let ss = l
          ss = ss.replace("@@ ", "")
          ss = ss.replace(" @@", "")
          ss = ss.replace("-","")
          ss = ss.replace("+","|")
          ss = ss.replace(" ","")
          ss = ss.split("|")

          let ds = ss[0].split(",")
          let deleteRow = parseInt(ds[0])
          let deleteRowCount = parseInt(ds[1]) - deleteRow

          let si = ss[1].split(",")
          let insertRow = parseInt(si[0])

          commands.push([ 'cursor', deleteRow, deleteRowCount, insertRow ])
        }

        if (l.startsWith("+") && !l.startsWith("++")) {
          let lt = ">>" + l
          lt = lt.replace(">>+", "")
          lt = lt.replace("\t", "  ")
          commands.push([ 'line', lt ])
        }

        if (l.startsWith(" ")) {
          let lt = ">>" + l
          lt = lt.replace(">> ", "")
          lt = lt.replace("\t", "  ")
          commands.push([ 'find', lt ])
        }

        if (l.startsWith("-") && !l.startsWith("--")) {
          let lt = ">>" + l
          lt = lt.replace(">>-", "")
          lt = lt.replace("\t", "  ")
          commands.push([ 'delete', lt ])
        }

      }
    }

    if (commands.length == 0)
      return true

      /*
    for(let c in commands) {
        console.log(commands[c])
    }
    */

    return self.executeCommands(commands)
  },

  parseGitLog() {

    let self = this

    if (self._isRunning) {
      self._isRunning = false
      return
    }

    self._isRunning = true

    // reset
    self.lastCursorPosition = null

    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      //
      // let height = editor.getHeight()
      // let range = editor.getVisibleRowRange()
      // if (range != null) {
      //   self.rowHeight = height / (range[1] - range[0])
      // }
      //
      self.rowHeight = editor.lineHeightInPixels
    }

    let cb
    if (cb = atom.clipboard) {
      let df = cb.read()
      let lines = df.split("\n")

      let diffs = []
      for(let i=0;i<lines.length;i++) {
        let l = lines[i]
        if (l.startsWith("diff --git a/"))
          diffs.push(i)
      }

      diffs.reverse()

      console.log(diffs)
      self.parseDiffs(diffs, lines)
    }
  },

  toggle() {
    return (
      this.modalPanel.isVisible() ?
      this.modalPanel.hide() :
      this.modalPanel.show()
    );
  }

};
