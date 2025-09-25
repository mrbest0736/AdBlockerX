// Minimal Aho-Corasick implementation for substring matching
// API: create an instance, call add(pattern, id), build(), then match(text) -> yields array of ids

class Node {
  constructor(){
    this.next = new Map();
    this.fail = null;
    this.out = [];
  }
}

class Aho {
  constructor(){
    this.root = new Node();
    this._built = false;
  }

  add(pattern, id){
    if(!pattern) return;
    let node = this.root;
    for(const ch of pattern){
      if(!node.next.has(ch)) node.next.set(ch, new Node());
      node = node.next.get(ch);
    }
    node.out.push(id === undefined ? pattern : id);
    this._built = false;
  }

  build(){
    const q = [];
    this.root.fail = this.root;
    // set fail links for depth 1
    for(const [ch, node] of this.root.next.entries()){
      node.fail = this.root;
      q.push(node);
    }
    while(q.length){
      const r = q.shift();
      for(const [ch, u] of r.next.entries()){
        q.push(u);
        let v = r.fail;
        while(v !== this.root && !v.next.has(ch)) v = v.fail;
        if(v.next.has(ch) && v.next.get(ch) !== u) u.fail = v.next.get(ch); else u.fail = this.root;
        u.out = u.out.concat(u.fail.out || []);
      }
    }
    this._built = true;
  }

  // returns list of matched ids (may contain duplicates if pattern repeats)
  match(text){
    if(!this._built) this.build();
    const results = [];
    let node = this.root;
    for(const ch of text){
      while(node !== this.root && !node.next.has(ch)) node = node.fail;
      if(node.next.has(ch)) node = node.next.get(ch);
      if(node.out && node.out.length) results.push(...node.out);
    }
    return results;
  }
}

module.exports = { Aho };
