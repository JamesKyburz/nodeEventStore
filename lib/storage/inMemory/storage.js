//     lib/storage/inMemory/storage.js v0.0.1
//     (c) 2011 Kaba AG, CC EAC; under MIT License
//     (by) Jan Muehlemann (jamuhl)
//        , Adriano Raiano (adrai)

// An __inMemory__ implemetation for storage. __Use only for development purpose.__   
// For production there is a wide range of options (mongoDb, redis, couchDb) or role your own implementation.
var uuid = require('./uuid')
  , root = this
  , inMemoryStorage
  , Storage;

if (typeof exports !== 'undefined') {
    inMemoryStorage = exports;
} else {
    inMemoryStorage = root.inMemoryStorage = {};
}

inMemoryStorage.VERSION = '0.0.1';

// Create new instance of storage.
inMemoryStorage.createStorage = function(options, callback) {
    new Storage(options, callback);
};

// ## inMemory storage
Storage = function(options, callback) { 
    if (typeof options === 'function')
        callback = options;

    this.store = {};
    this.snapshots = {};
    
    callback(null, this);
};

Storage.prototype = {

    // This function saves an event in the storage.
    addEvents: function(events, callback) {
        if (!events || events.length === 0) { 
            callback(null);
            return;
        }
        
        if (!this.store[events[0].streamId]) {
            this.store[events[0].streamId] = [];
        }
        
        this.store[events[0].streamId] =  this.store[events[0].streamId].concat(events);
        callback(null);
    },
    
    // This function saves a snapshot in the storage.
    addSnapshot: function(snapshot, callback) {
        if (!this.snapshots[snapshot.streamId]) {
            this.snapshots[snapshot.streamId] = [];
        }
        
        this.snapshots[snapshot.streamId].push(snapshot);
        callback(null);
    },

    // This function returns the wished events.
    getEvents: function(streamId, minRev, maxRev, callback) {
        
        if (typeof maxRev === 'function') {
            callback = maxRev;
            maxRev = -1;
        }
        
        if (!this.store[streamId]) {
           callback(null, []);
        }
        else {
            if (maxRev === -1) {
                callback(null, this.store[streamId].slice(minRev));
            }
            else {
                callback(null, this.store[streamId].slice(minRev, maxRev));
            }
        }
    },
    
    // This function returns all events.
    getAllEvents: function(callback) {
        var events = [];
        for (var i in this.store) {
            events = events.concat(this.store[i]);
        }
        
        events.sort(function(a, b){
             return a.commitStamp - b.commitStamp;
        });
        
        callback(null, events);
    },

    // This function returns a range of events.
    getEventRange: function(index, amount, callback) {
        var events = [];
        for (var i in this.store) {
            events = events.concat(this.store[i]);

            if (events.length >= (index + amount)) {
                break;
            }
        }
        
        events = events.slice(index, (index + amount));

        events.sort(function(a, b){
             return a.commitStamp - b.commitStamp;
        });

        callback(null, events);
    },

    // This function returns the wished snapshot.
    // If revMax is -1 returns the latest snapshot.
    getSnapshot: function(streamId, maxRev, callback) {
        
        if (typeof maxRev === 'function') {
            callback = maxRev;
            maxRev = -1;
        }
        
        if (!this.snapshots[streamId]) {
           callback(null, {});
        }
        else {
            if (maxRev == -1) {
                callback(null, this.snapshots[streamId][this.snapshots[streamId].length - 1]);
            } else {
                var snaps = this.snapshots[streamId];
                for (var i = snaps.length -1; i >= 0; i--) {
                    if (snaps[i].revision <= maxRev) {
                        callback(null, snaps[i]);
                        return;
                    }
                }
            }
        }
    },
    
    // This function returns all undispatched events.
    getUndispatchedEvents: function(callback) {
        var array = [];
        
        for (var ele in this.store) {
            var elem = this.store[ele];
            for (var evt in elem) {
                if (elem[evt].dispatched === false) {
                    array.push(elem[evt]);
                }
            }
        }
        
        callback(null, array);
    },
    
    // This function set an event to dispatched.
    setEventToDispatched: function(evt) {
        evt.dispatched = true;
    },
    
    // This function returns a new id.
    getId: function(callback) {
        callback(null, uuid().toString());
    }
};